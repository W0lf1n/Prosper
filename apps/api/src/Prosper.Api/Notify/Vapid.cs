using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Prosper.Api.Notify;

/// <summary>
/// The server's identity to the push services — RFC 8292, VAPID.
///
/// A push service (FCM for Chrome, Apple's for Safari, Mozilla's for Firefox)
/// accepts a message for a subscription only from the key pair the
/// subscription was made against. The public half goes to the phone
/// (<c>GET /api/v1/notify/key</c>); the private half signs a short-lived JWT
/// on every push. Nothing else is needed, because the push carries no payload
/// — there is nothing to encrypt (RFC 8291 is for content, and this has none).
///
/// Hand-rolled on <see cref="ECDsa"/> and <see cref="Base64Url"/> rather than
/// a NuGet package: P-256 and ES256 are forty lines, and the server ships four
/// packages, all of them EF.
/// </summary>
public sealed class Vapid
{
    /// <summary>How long a signature is good for. RFC 8292 caps it at a day.</summary>
    public static readonly TimeSpan Lifetime = TimeSpan.FromHours(12);

    private readonly ECDsa _key;

    /// <summary>Base64url, uncompressed point: <c>0x04 ‖ X ‖ Y</c>, 65 bytes.</summary>
    public string PublicKey { get; }

    /// <summary>A <c>mailto:</c> or <c>https:</c> contact the push services may use.</summary>
    public string Subject { get; }

    private Vapid(ECDsa key, string publicKey, string subject)
    {
        _key = key;
        PublicKey = publicKey;
        Subject = subject;
    }

    /// <summary>
    /// The configured pair, or null when push is not set up — which is a
    /// supported state: the app works without notices reaching a closed phone.
    /// </summary>
    public static Vapid? FromConfig(string? publicKey, string? privateKey, string? subject)
    {
        if (string.IsNullOrWhiteSpace(publicKey) || string.IsNullOrWhiteSpace(privateKey)) return null;

        var point = Base64Url.DecodeFromChars(publicKey.Trim());
        var d = Base64Url.DecodeFromChars(privateKey.Trim());
        if (point.Length != 65 || point[0] != 0x04 || d.Length != 32)
        {
            throw new InvalidOperationException(
                "Notify:PublicKey must be a 65-byte uncompressed P-256 point and Notify:PrivateKey 32 bytes, both base64url. `dotnet run -- vapid` makes a pair.");
        }

        var key = ECDsa.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            D = d,
            Q = new ECPoint { X = point[1..33], Y = point[33..65] }
        });
        return new Vapid(key, publicKey.Trim(), string.IsNullOrWhiteSpace(subject)
            ? "mailto:prosper@localhost"
            : subject.Trim());
    }

    /// <summary>A fresh pair, for <c>dotnet run -- vapid</c>.</summary>
    public static (string PublicKey, string PrivateKey) Generate()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var parameters = key.ExportParameters(includePrivateParameters: true);
        var point = new byte[65];
        point[0] = 0x04;
        parameters.Q.X!.CopyTo(point, 1);
        parameters.Q.Y!.CopyTo(point, 33);
        return (Base64Url.EncodeToString(point), Base64Url.EncodeToString(parameters.D!));
    }

    /// <summary>
    /// <c>Authorization: vapid t=…, k=…</c> for one push service. The audience
    /// is the endpoint's origin, so one signature serves every subscription on
    /// the same service until it expires.
    /// </summary>
    public string AuthorizationFor(Uri endpoint, DateTimeOffset now)
    {
        var audience = endpoint.GetLeftPart(UriPartial.Authority);
        var header = Base64Url.EncodeToString("""{"typ":"JWT","alg":"ES256"}"""u8.ToArray());
        var claims = Base64Url.EncodeToString(JsonSerializer.SerializeToUtf8Bytes(new Dictionary<string, object>
        {
            ["aud"] = audience,
            ["exp"] = (now + Lifetime).ToUnixTimeSeconds(),
            ["sub"] = Subject
        }));
        var signingInput = $"{header}.{claims}";
        // IEEE P1363 (r ‖ s, 64 bytes) is .NET's default, and exactly what ES256 wants.
        var signature = _key.SignData(Encoding.ASCII.GetBytes(signingInput), HashAlgorithmName.SHA256);
        return $"vapid t={signingInput}.{Base64Url.EncodeToString(signature)}, k={PublicKey}";
    }
}
