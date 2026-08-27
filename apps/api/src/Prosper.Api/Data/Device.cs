namespace Prosper.Api.Data;

/// <summary>
/// A paired device.
///
/// There is no account, no password and no e-mail: one person, their own
/// devices, and a pairing code typed once. The token is device-bound and does
/// not expire — an expiry short enough to matter would log the phone out
/// somewhere with no signal, which is the one place this app must keep working.
/// </summary>
public sealed class Device
{
    public required string Id { get; set; }
    public required string Name { get; set; }

    /// <summary>Stored as a SHA-256 hash. The plaintext exists only in transit.</summary>
    public required string TokenHash { get; set; }

    public DateTimeOffset PairedAt { get; set; }
    public DateTimeOffset? LastSeenAt { get; set; }
}
