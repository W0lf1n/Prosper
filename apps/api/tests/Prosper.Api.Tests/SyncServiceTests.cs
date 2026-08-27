using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Prosper.Api.Data;
using Prosper.Api.Sync;
using Xunit;

namespace Prosper.Api.Tests;

/// <summary>
/// SQLite in memory rather than the EF in-memory provider: this code opens
/// transactions and relies on a unique index, and the in-memory provider
/// honours neither. A fake that cannot fail the way the real thing fails is a
/// fake that proves nothing.
/// </summary>
public sealed class SyncServiceTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly AppDbContext _db;
    private readonly SyncService _sync;

    public SyncServiceTests()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();

        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(_connection)
            .Options;

        _db = new AppDbContext(options);
        _db.Database.EnsureCreated();
        _sync = new SyncService(_db);
    }

    public void Dispose()
    {
        _db.Dispose();
        _connection.Dispose();
    }

    private static SyncRow Row(
        string id,
        string updatedAt,
        string deviceId = "phone",
        bool isDeleted = false,
        string payee = "Obed",
        string entity = "txn")
    {
        var payload = JsonSerializer.SerializeToElement(new
        {
            id,
            payee,
            updatedAt,
            deviceId,
            isDeleted
        });
        return new SyncRow(entity, id, updatedAt, deviceId, isDeleted, payload);
    }

    // -- the merge rule ------------------------------------------------------

    [Fact]
    public async Task A_new_row_is_stored()
    {
        var result = await _sync.PushAsync([Row("a", "2026-08-01T10:00:00.000Z")]);

        Assert.Equal(1, result.Applied);
        Assert.Equal(0, result.Superseded);
        Assert.Empty(result.Rejected);
    }

    [Fact]
    public async Task A_newer_row_wins()
    {
        await _sync.PushAsync([Row("a", "2026-08-01T10:00:00.000Z", payee: "Stare")]);
        var result = await _sync.PushAsync([Row("a", "2026-08-02T10:00:00.000Z", payee: "Nove")]);

        Assert.Equal(1, result.Applied);
        var stored = await _db.Changes.SingleAsync();
        Assert.Contains("Nove", stored.Payload);
    }

    [Fact]
    public async Task An_older_row_is_superseded_not_rejected()
    {
        await _sync.PushAsync([Row("a", "2026-08-02T10:00:00.000Z", payee: "Nove")]);
        var result = await _sync.PushAsync([Row("a", "2026-08-01T10:00:00.000Z", payee: "Stare")]);

        // Losing a last-write-wins race is the protocol working, not an error.
        Assert.Equal(0, result.Applied);
        Assert.Equal(1, result.Superseded);
        Assert.Empty(result.Rejected);

        var stored = await _db.Changes.SingleAsync();
        Assert.Contains("Nove", stored.Payload);
    }

    [Fact]
    public async Task A_tie_is_broken_on_deviceId()
    {
        const string when = "2026-08-01T10:00:00.000Z";
        await _sync.PushAsync([Row("a", when, deviceId: "aaa", payee: "A")]);
        await _sync.PushAsync([Row("a", when, deviceId: "zzz", payee: "Z")]);

        var stored = await _db.Changes.SingleAsync();
        Assert.Equal("zzz", stored.DeviceId);
    }

    [Fact]
    public async Task A_tie_the_other_way_round_does_not_flip()
    {
        const string when = "2026-08-01T10:00:00.000Z";
        await _sync.PushAsync([Row("a", when, deviceId: "zzz", payee: "Z")]);
        await _sync.PushAsync([Row("a", when, deviceId: "aaa", payee: "A")]);

        var stored = await _db.Changes.SingleAsync();
        Assert.Equal("zzz", stored.DeviceId);
    }

    [Fact]
    public async Task A_delete_is_never_undone_by_a_merge()
    {
        await _sync.PushAsync([Row("a", "2026-08-01T10:00:00.000Z", isDeleted: true)]);
        await _sync.PushAsync([Row("a", "2099-01-01T00:00:00.000Z", isDeleted: false, payee: "Zpet")]);

        var stored = await _db.Changes.SingleAsync();
        // The newer row wins every other field, and the row stays gone.
        Assert.True(stored.IsDeleted);
        Assert.Contains("Zpet", stored.Payload);
    }

    // -- idempotency ---------------------------------------------------------

    [Fact]
    public async Task Pushing_the_same_row_twice_is_a_no_op()
    {
        var row = Row("a", "2026-08-01T10:00:00.000Z");
        await _sync.PushAsync([row]);
        var second = await _sync.PushAsync([row]);

        Assert.Equal(0, second.Applied);
        Assert.Equal(1, second.Superseded);
        Assert.Equal(1, await _db.Changes.CountAsync());
    }

    [Fact]
    public async Task The_same_id_under_two_entities_is_two_rows()
    {
        await _sync.PushAsync([Row("shared", "2026-08-01T10:00:00.000Z", entity: "txn")]);
        await _sync.PushAsync([Row("shared", "2026-08-01T10:00:00.000Z", entity: "goal")]);

        Assert.Equal(2, await _db.Changes.CountAsync());
    }

    // -- validation ----------------------------------------------------------

    [Fact]
    public async Task An_unknown_entity_is_rejected_and_the_rest_of_the_batch_survives()
    {
        var result = await _sync.PushAsync([
            Row("a", "2026-08-01T10:00:00.000Z", entity: "nonsense"),
            Row("b", "2026-08-01T10:00:00.000Z")
        ]);

        Assert.Equal(1, result.Applied);
        var rejection = Assert.Single(result.Rejected);
        Assert.Equal("unknown-entity", rejection.Reason);
    }

    [Fact]
    public async Task A_row_with_no_updatedAt_is_rejected()
    {
        var result = await _sync.PushAsync([Row("a", "")]);

        Assert.Equal("malformed", Assert.Single(result.Rejected).Reason);
    }

    [Fact]
    public async Task An_oversized_payload_is_rejected()
    {
        var huge = new string('x', SyncLimits.MaxPayloadBytes + 1);
        var result = await _sync.PushAsync([Row("a", "2026-08-01T10:00:00.000Z", payee: huge)]);

        Assert.Equal("too-large", Assert.Single(result.Rejected).Reason);
    }

    [Fact]
    public async Task A_batch_over_the_limit_is_refused_whole()
    {
        var batch = Enumerable
            .Range(0, SyncLimits.MaxPushBatch + 1)
            .Select(i => Row($"r{i}", "2026-08-01T10:00:00.000Z"))
            .ToList();

        await Assert.ThrowsAsync<ArgumentException>(() => _sync.PushAsync(batch));
    }

    // -- the cursor ----------------------------------------------------------

    [Fact]
    public async Task The_cursor_is_monotonic_across_entities()
    {
        await _sync.PushAsync([
            Row("a", "2026-08-01T10:00:00.000Z", entity: "txn"),
            Row("b", "2026-08-01T10:00:00.000Z", entity: "goal"),
            Row("c", "2026-08-01T10:00:00.000Z", entity: "holding")
        ]);

        var seqs = await _db.Changes.OrderBy(c => c.Seq).Select(c => c.Seq).ToListAsync();
        Assert.Equal([1L, 2L, 3L], seqs);
    }

    [Fact]
    public async Task An_update_moves_the_row_to_the_end_of_the_cursor()
    {
        await _sync.PushAsync([
            Row("a", "2026-08-01T10:00:00.000Z"),
            Row("b", "2026-08-01T10:00:00.000Z")
        ]);
        await _sync.PushAsync([Row("a", "2026-08-05T10:00:00.000Z", payee: "Upravene")]);

        // Otherwise a device that already pulled past seq 1 would never see the
        // edit -- the silent failure this design exists to prevent.
        var a = await _db.Changes.SingleAsync(c => c.EntityId == "a");
        Assert.Equal(3, a.Seq);
    }

    [Fact]
    public async Task A_superseded_row_does_not_burn_a_cursor_number()
    {
        await _sync.PushAsync([Row("a", "2026-08-05T10:00:00.000Z")]);
        await _sync.PushAsync([Row("a", "2026-08-01T10:00:00.000Z")]);

        var state = await _db.SyncState.SingleAsync();
        Assert.Equal(1, state.LastSeq);
    }

    // -- pull ----------------------------------------------------------------

    [Fact]
    public async Task Pull_returns_everything_past_the_cursor_in_order()
    {
        await _sync.PushAsync([
            Row("a", "2026-08-01T10:00:00.000Z"),
            Row("b", "2026-08-01T10:00:00.000Z"),
            Row("c", "2026-08-01T10:00:00.000Z")
        ]);

        var page = await _sync.PullAsync(since: 1, limit: 100);

        Assert.Equal(["b", "c"], page.Changes.Select(c => c.Id));
        Assert.Equal(3, page.Cursor);
        Assert.False(page.HasMore);
    }

    [Fact]
    public async Task Pull_pages_and_says_so()
    {
        await _sync.PushAsync(
            Enumerable.Range(0, 5).Select(i => Row($"r{i}", "2026-08-01T10:00:00.000Z")).ToList());

        var first = await _sync.PullAsync(since: 0, limit: 2);

        Assert.Equal(2, first.Changes.Count);
        Assert.True(first.HasMore);
        Assert.Equal(2, first.Cursor);

        var second = await _sync.PullAsync(since: first.Cursor, limit: 2);
        Assert.Equal(["r2", "r3"], second.Changes.Select(c => c.Id));
    }

    [Fact]
    public async Task Pull_on_an_empty_log_holds_the_cursor_still()
    {
        var page = await _sync.PullAsync(since: 9, limit: 10);

        Assert.Empty(page.Changes);
        Assert.Equal(9, page.Cursor);
        Assert.False(page.HasMore);
    }

    [Fact]
    public async Task Pull_carries_the_payload_back_unchanged()
    {
        await _sync.PushAsync([Row("a", "2026-08-01T10:00:00.000Z", payee: "Vchodove dvere")]);

        var page = await _sync.PullAsync(since: 0, limit: 10);

        Assert.Equal("Vchodove dvere", page.Changes[0].Payload.GetProperty("payee").GetString());
    }

    [Fact]
    public async Task A_deleted_row_is_still_pulled()
    {
        // Soft delete only: the row must reach the other device, flagged, or the
        // delete never propagates.
        await _sync.PushAsync([Row("a", "2026-08-01T10:00:00.000Z", isDeleted: true)]);

        var page = await _sync.PullAsync(since: 0, limit: 10);

        Assert.True(Assert.Single(page.Changes).IsDeleted);
    }
}
