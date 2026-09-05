using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Prosper.Api.Data;

namespace Prosper.Api.Sync;

/// <summary>
/// Pairing, and the check on every request afterwards.
///
/// Tokens are stored as SHA-256 hashes: the plaintext exists in transit and in
/// the client's IndexedDB, and nowhere on the server. A dump of the database
/// therefore does not hand anybody a working device.
///
/// No expiry, deliberately. A token that expires logs the phone out at the
/// worst possible moment — somewhere with no signal — and the recovery is
/// re-pairing, which needs the code, which is on the machine the user is not
/// holding. Revocation is deleting the row.
/// </summary>
public sealed class DeviceAuth(AppDbContext db)
{
    public static string Hash(string token)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(token));
        return Convert.ToBase64String(bytes);
    }

    /// <summary>256 bits, URL-safe, from the OS generator.</summary>
    public static string NewToken()
    {
        Span<byte> bytes = stackalloc byte[32];
        RandomNumberGenerator.Fill(bytes);
        return Convert.ToBase64String(bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=');
    }

    /// <summary>
    /// Constant-time compare on the *code*, so a wrong guess cannot be narrowed
    /// down by timing it. The code is short and human-typed, which is exactly
    /// the shape a timing attack likes.
    /// </summary>
    public static bool CodeMatches(string expected, string given)
    {
        var a = Encoding.UTF8.GetBytes(expected);
        var b = Encoding.UTF8.GetBytes(given);
        return CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(a),
            SHA256.HashData(b));
    }

    public async Task<PairResponse> PairAsync(string deviceName, CancellationToken ct = default)
    {
        var token = NewToken();
        var device = new Device
        {
            Id = Guid.NewGuid().ToString("N"),
            Name = Fit(deviceName),
            TokenHash = Hash(token),
            PairedAt = DateTimeOffset.UtcNow
        };

        db.Devices.Add(device);
        await db.SaveChangesAsync(ct);

        return new PairResponse(device.Id, token);
    }

    public async Task<Device?> ResolveAsync(string? authorization, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(authorization)) return null;
        if (!authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return null;

        var token = authorization["Bearer ".Length..].Trim();
        if (token.Length == 0) return null;

        var hash = Hash(token);
        var device = await db.Devices.FirstOrDefaultAsync(d => d.TokenHash == hash, ct);
        if (device is null) return null;

        // `LastSeenAt` is diagnostics, and diagnostics do not get a write per
        // request. Stamping it on every call turned every read-only pull into
        // an UPDATE — a WAL record, and eventually autovacuum work, to record a
        // timestamp to the second that nobody reads to the hour. A quarter of an
        // hour is as precise as the answer ever needs to be.
        var now = DateTimeOffset.UtcNow;
        if (device.LastSeenAt is null || now - device.LastSeenAt.Value > LastSeenPrecision)
        {
            device.LastSeenAt = now;
            await db.SaveChangesAsync(ct);
        }

        return device;
    }

    /// <summary>How stale <see cref="Device.LastSeenAt"/> is allowed to get.</summary>
    private static readonly TimeSpan LastSeenPrecision = TimeSpan.FromMinutes(15);

    /// <summary>
    /// Trimmed, defaulted, and cut to <see cref="Device.NameMaxLength"/>.
    ///
    /// The name is free text typed on a phone and stored in a column of a
    /// fixed width. A cut is quieter than a 500 for a row nobody reads but the
    /// person who typed it. The cut never lands between the two halves of a
    /// surrogate pair — an emoji at the edge is dropped whole rather than left
    /// as a lone half that Postgres cannot encode.
    /// </summary>
    internal static string Fit(string? deviceName)
    {
        var name = deviceName?.Trim() ?? string.Empty;
        if (name.Length == 0) return "Zařízení";
        if (name.Length <= Device.NameMaxLength) return name;

        var cut = Device.NameMaxLength;
        if (char.IsHighSurrogate(name[cut - 1])) cut -= 1;
        return name[..cut];
    }
}
