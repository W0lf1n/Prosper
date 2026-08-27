namespace Prosper.Api.Data;

/// <summary>
/// One row of the ledger, as the server holds it.
///
/// The server is durable storage and a cross-device merge point — not an
/// authority on what a transaction means. It stores the client's row verbatim
/// as JSON and reasons only about the four fields it needs to merge: which
/// entity, which id, when it was written and by which device.
///
/// A typed column per domain field was the original plan (PROJECT-PLAN §6).
/// It was not built, and the reason is <see cref="Seq"/>: §10.2 requires a
/// server-assigned monotonic cursor across *every* entity, and ten typed tables
/// cannot produce one without a log table alongside them. This is that log
/// table, and having it be the storage as well is one moving part rather than
/// eleven.
/// </summary>
public sealed class ChangeRow
{
    /// <summary>Surrogate key. Never leaves the server.</summary>
    public long Id { get; set; }

    /// <summary>
    /// The pull cursor. Bumped on every write, including an update, so a row
    /// edited on one device is picked up by the next pull on the other.
    /// </summary>
    public long Seq { get; set; }

    public required string Entity { get; set; }

    /// <summary>The client-generated UUIDv7. The server never assigns one.</summary>
    public required string EntityId { get; set; }

    /// <summary>The authoring device's clock. The last-write-wins key.</summary>
    public required string UpdatedAt { get; set; }

    /// <summary>Breaks an <see cref="UpdatedAt"/> tie by plain string compare.</summary>
    public required string DeviceId { get; set; }

    public bool IsDeleted { get; set; }

    /// <summary>The whole client row, as JSON. Never parsed, only stored.</summary>
    public required string Payload { get; set; }
}
