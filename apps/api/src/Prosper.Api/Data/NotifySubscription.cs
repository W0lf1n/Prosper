namespace Prosper.Api.Data;

/// <summary>
/// Where to wake one device, and when.
///
/// One row per paired device; a second subscribe replaces the first. The
/// endpoint is a capability URL — whoever holds it can wake the phone — so it
/// is never logged whole. The two keys are stored for the day a push carries a
/// payload; today it does not, and they are never read.
///
/// Not part of the ledger: it is not synced, not soft-deleted, and a device
/// that turns its notices off removes its row outright.
/// </summary>
public sealed class NotifySubscription
{
    public const int EndpointMaxLength = 1024;
    public const int KeyMaxLength = 128;

    public required string DeviceId { get; set; }
    public required string Endpoint { get; set; }
    public required string P256dh { get; set; }
    public required string Auth { get; set; }

    /// <summary>Unix milliseconds, ascending, comma-separated — <see cref="Notify.WakeList"/>.</summary>
    public required string Wakes { get; set; }

    /// <summary>The front of <see cref="Wakes"/>, indexed: the scheduler's only question.</summary>
    public long? NextWakeAt { get; set; }

    /// <summary>Unix milliseconds of the last subscribe.</summary>
    public long UpdatedAt { get; set; }
}
