using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Prosper.Api.Data;

namespace Prosper.Api.Sync;

/// <summary>
/// Push and pull, and the merge rule that decides between them.
///
/// The rule is last-write-wins on <c>updatedAt</c>, ties broken on
/// <c>deviceId</c> by ordinal string compare — the same function the client
/// runs in <c>@vydaje/contracts</c>. It is written twice because the two sides
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

        var state = await db.SyncState.FirstOrDefaultAsync(ct);
        if (state is null)
        {
            state = new SyncState { Id = 1, LastSeq = 0 };
            db.SyncState.Add(state);
        }

        foreach (var row in changes)
        {
            var problem = Validate(row);
            if (problem is not null)
            {
                rejected.Add(problem);
                continue;
            }

            var existing = await db.Changes
                .FirstOrDefaultAsync(c => c.Entity == row.Entity && c.EntityId == row.Id, ct);

            if (!IncomingWins(row, existing))
            {
                superseded++;
                continue;
            }

            state.LastSeq++;

            if (existing is null)
            {
                db.Changes.Add(new ChangeRow
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
                });
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

        var changes = rows
            .Select(c => new SyncRow(
                c.Entity,
                c.EntityId,
                c.UpdatedAt,
                c.DeviceId,
                c.IsDeleted,
                JsonDocument.Parse(c.Payload).RootElement.Clone()))
            .ToList();

        var cursor = rows.Count > 0 ? rows[^1].Seq : since;
        return new PullResponse(changes, cursor, hasMore);
    }
}
