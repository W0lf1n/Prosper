using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Prosper.Api.Data;

namespace Prosper.Api.Sync;

/// <summary>
/// Push and pull, and the merge rule that decides between them.
///
/// The rule is last-write-wins on <c>updatedAt</c>, ties broken on
/// <c>deviceId</c> by ordinal string compare — the same function the client
/// runs in <c>@prosper/contracts</c>. It is written twice because the two sides
/// are two languages; it is tested twice for the same reason.
///
/// <c>updatedAt</c> is a client clock and that is accepted, not overlooked: one
/// person, their own devices, skew measured in seconds. A server clock would be
/// worse — it would make a row's version depend on when it happened to arrive,
/// so a phone that was offline for a week would win every conflict on
/// reconnect.
/// </summary>
public sealed class SyncService(AppDbContext db)
{
    /// <summary>Ordinal, so it matches JavaScript's <c>&gt;</c> on strings exactly.</summary>
    internal static bool IncomingWins(SyncRow incoming, ChangeRow? existing)
    {
        if (existing is null) return true;

        var byTime = string.CompareOrdinal(incoming.UpdatedAt, existing.UpdatedAt);
        if (byTime != 0) return byTime > 0;

        return string.CompareOrdinal(incoming.DeviceId, existing.DeviceId) > 0;
    }

    internal static SyncRejection? Validate(SyncRow row)
    {
        if (!SyncLimits.Entities.Contains(row.Entity))
            return new SyncRejection(row.Entity, row.Id, "unknown-entity", "Neznámý typ řádku.");

        if (string.IsNullOrWhiteSpace(row.Id))
            return new SyncRejection(row.Entity, row.Id, "malformed", "Chybí id.");

        if (string.IsNullOrWhiteSpace(row.UpdatedAt))
            return new SyncRejection(row.Entity, row.Id, "malformed", "Chybí updatedAt.");

        if (string.IsNullOrWhiteSpace(row.DeviceId))
            return new SyncRejection(row.Entity, row.Id, "malformed", "Chybí deviceId.");

        if (row.Payload.ValueKind != JsonValueKind.Object)
            return new SyncRejection(row.Entity, row.Id, "malformed", "Payload není objekt.");

        var size = row.Payload.GetRawText().Length;
        if (size > SyncLimits.MaxPayloadBytes)
            return new SyncRejection(row.Entity, row.Id, "too-large", $"{size} B je moc.");

        return null;
    }

    /// <summary>
    /// Apply a batch, idempotently.
    ///
    /// Idempotent on <c>(entity, id)</c>: re-pushing a row the server already
    /// holds is a no-op or an update, never a duplicate. That is what lets the
    /// client retry a batch it is not sure landed, which is the whole reason
    /// the outbox can be simple.
    /// </summary>
    public async Task<PushResponse> PushAsync(IReadOnlyList<SyncRow> changes, CancellationToken ct = default)
    {
        var rejected = new List<SyncRejection>();
        var applied = 0;
        var superseded = 0;

        if (changes.Count > SyncLimits.MaxPushBatch)
            throw new ArgumentException($"Nejvýš {SyncLimits.MaxPushBatch} řádků na dávku.", nameof(changes));

        // One transaction for the batch, so the cursor it allocates and the rows
        // it numbers commit together or not at all.
        await using var tx = await db.Database.BeginTransactionAsync(ct);

        // The cursor row, **locked for the rest of the transaction**.
        //
        // Reading it without the lock is what made the "this serialises pushes"
        // claim untrue: under READ COMMITTED two devices both read LastSeq = 100,
        // both number their rows from 101, and the second one dies on the unique
        // index over Seq — a 500 for a case the sync server exists to handle.
        // `FOR UPDATE` makes the second push wait for the first to commit and
        // then read the number it actually left behind.
        //
        // SQLite takes no such lock and needs none: it admits one writer at a
        // time for the whole database, which is the same guarantee by a blunter
        // route. The row is read plainly there.
        var state = db.Database.IsNpgsql()
            ? await db.SyncState
                .FromSqlRaw("SELECT * FROM sync_state WHERE \"Id\" = 1 FOR UPDATE")
                .FirstOrDefaultAsync(ct)
            : await db.SyncState.FirstOrDefaultAsync(ct);

        if (state is null)
        {
            state = new SyncState { Id = 1, LastSeq = 0 };
            db.SyncState.Add(state);
            // There is nothing to lock until the row exists. Saving it now takes
            // the row lock for the rest of this transaction, so the very first
            // two pushes race no differently from every one after them.
            await db.SaveChangesAsync(ct);
        }

        // Validated once, up front, and the verdicts kept by position. The size
        // check materialises the payload's raw text, so asking twice per row —
        // once to filter and once in the loop — would allocate the whole batch
        // twice over.
        var problems = new SyncRejection?[changes.Count];
        for (var i = 0; i < changes.Count; i++) problems[i] = Validate(changes[i]);

        // Every row the batch might update, in one query rather than one query
        // per row. A 200-row batch was 200 sequential round trips, all of them
        // inside this transaction and holding the cursor lock while they ran.
        // The unique index on (Entity, EntityId) serves this directly.
        var valid = changes.Where((_, i) => problems[i] is null).ToList();
        var entities = valid.Select(r => r.Entity).Distinct().ToList();
        var ids = valid.Select(r => r.Id).Distinct().ToList();

        var existingRows = new Dictionary<(string Entity, string EntityId), ChangeRow>();
        if (valid.Count > 0)
        {
            // Over-fetches slightly — the cross product of entities and ids
            // rather than the exact pairs — but both lists are small, the index
            // covers the lookup, and the alternative is a query per row.
            var found = await db.Changes
                .Where(c => entities.Contains(c.Entity) && ids.Contains(c.EntityId))
                .ToListAsync(ct);

            foreach (var c in found) existingRows[(c.Entity, c.EntityId)] = c;
        }

        for (var i = 0; i < changes.Count; i++)
        {
            var row = changes[i];

            if (problems[i] is { } problem)
            {
                rejected.Add(problem);
                continue;
            }

            existingRows.TryGetValue((row.Entity, row.Id), out var existing);

            if (!IncomingWins(row, existing))
            {
                superseded++;
                continue;
            }

            state.LastSeq++;

            if (existing is null)
            {
                var inserted = new ChangeRow
                {
                    Seq = state.LastSeq,
                    Entity = row.Entity,
                    EntityId = row.Id,
                    UpdatedAt = row.UpdatedAt,
                    DeviceId = row.DeviceId,
                    // A delete is never undone by a merge. On a first insert
                    // there is nothing to preserve, so the incoming flag stands.
                    IsDeleted = row.IsDeleted,
                    Payload = row.Payload.GetRawText()
                };
                db.Changes.Add(inserted);
                // A row edited twice offline is two entries in one batch. The
                // second must find the first, or both are inserted and the
                // unique index over (Entity, EntityId) refuses the pair.
                existingRows[(row.Entity, row.Id)] = inserted;
            }
            else
            {
                existing.Seq = state.LastSeq;
                existing.UpdatedAt = row.UpdatedAt;
                existing.DeviceId = row.DeviceId;
                // The winner decides every other field; `isDeleted` is the one
                // where either side saying "gone" wins for good.
                existing.IsDeleted = row.IsDeleted || existing.IsDeleted;
                existing.Payload = row.Payload.GetRawText();
            }

            applied++;
        }

        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        return new PushResponse(applied, superseded, rejected, state.LastSeq);
    }

    /// <summary>
    /// Everything past <paramref name="since"/>, in cursor order.
    ///
    /// The cursor is the server's own sequence and never a wall-clock time
    /// (§10.2): a timestamp cursor loses rows whose clocks tie and repeats them
    /// when a clock steps back, and both failures are silent.
    /// </summary>
    public async Task<PullResponse> PullAsync(long since, int limit, CancellationToken ct = default)
    {
        var take = Math.Clamp(limit, 1, SyncLimits.MaxPullPage);

        var rows = await db.Changes
            .Where(c => c.Seq > since)
            .OrderBy(c => c.Seq)
            .Take(take + 1)
            .ToListAsync(ct);

        var hasMore = rows.Count > take;
        if (hasMore) rows.RemoveAt(rows.Count - 1);

        var changes = rows.Select(ToSyncRow).ToList();

        var cursor = rows.Count > 0 ? rows[^1].Seq : since;
        return new PullResponse(changes, cursor, hasMore);
    }

    /// <summary>
    /// The stored row, as the wire type.
    ///
    /// The <c>using</c> is the whole point. <see cref="JsonDocument"/> rents its
    /// backing array from a shared pool and returns it on dispose; five hundred
    /// undisposed documents a page, every page, is a pool that never gets its
    /// buffers back and allocates fresh ones instead. <c>Clone()</c> copies the
    /// element out first, so the returned value outlives the document.
    /// </summary>
    private static SyncRow ToSyncRow(ChangeRow c)
    {
        using var payload = JsonDocument.Parse(c.Payload);
        return new SyncRow(
            c.Entity,
            c.EntityId,
            c.UpdatedAt,
            c.DeviceId,
            c.IsDeleted,
            payload.RootElement.Clone());
    }
}
