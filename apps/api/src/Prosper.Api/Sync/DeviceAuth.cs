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
            Name = string.IsNullOrWhiteSpace(deviceName) ? "Zařízení" : deviceName.Trim(),
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

        var device = await db.Devices.FirstOrDefaultAsync(d => d.TokenHash == Hash(token), ct);
        if (device is null) return null;

        device.LastSeenAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return device;
    }
}
