namespace Prosper.Api.Sync;

/// <summary>
/// The wire types, mirroring <c>packages/contracts/src/index.ts</c>.
///
/// Kept as records with the same field names and casing the client sends, so
/// the mirror is checked by the serializer rather than by reading two files
/// side by side. A field renamed on one side fails a round-trip test on the
/// other.
/// </summary>
public sealed record SyncRow(
    string Entity,
    string Id,
    string UpdatedAt,
    string DeviceId,
    bool IsDeleted,
    System.Text.Json.JsonElement Payload);

public sealed record SyncRejection(string Entity, string Id, string Reason, string Detail);

public sealed record PairRequest(string Code, string DeviceName);

public sealed record PairResponse(string DeviceId, string Token);

public sealed record PushRequest(IReadOnlyList<SyncRow> Changes);

public sealed record PushResponse(
    int Applied,
    int Superseded,
    IReadOnlyList<SyncRejection> Rejected,
    long ServerCursor);

public sealed record PullResponse(IReadOnlyList<SyncRow> Changes, long Cursor, bool HasMore);

public sealed record HealthResponse(bool Ok, string Version);

public static class SyncLimits
{
    public const int MaxPushBatch = 500;
    public const int MaxPullPage = 500;

    /// <summary>
    /// A single row's payload ceiling. A transaction is a few hundred bytes; a
    /// megabyte of it is a bug or an attack, and either way the answer is the
    /// same and it is not "store it".
    /// </summary>
    public const int MaxPayloadBytes = 64 * 1024;

    /// <summary>The entity kinds the client is allowed to send.</summary>
    public static readonly HashSet<string> Entities =
    [
        "txn", "account", "category", "goal", "monthTarget",
        "reconciliation", "dayMark", "holding", "valuation", "schedule"
    ];
}
