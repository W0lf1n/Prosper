using System.Net;
using System.Net.Sockets;

namespace Prosper.Api.Sync;

/// <summary>
/// Which address a request is counted against by the pairing rate limiter.
///
/// Two nginx layers sit in front of this server: the host's, which owns the
/// domain and terminates TLS, and the container's, which serves the client and
/// proxies here. Both overwrite <c>X-Real-IP</c> with their own peer, so the
/// value that arrives was written by the container's nginx — which, because of
/// the <c>real_ip</c> block in <c>deploy/nginx/app.conf</c>, is the address the
/// host's nginx accepted a connection from. A caller cannot choose it.
///
/// <c>X-Forwarded-For</c> is the header that looks like the right answer and is
/// not. <c>$proxy_add_x_forwarded_for</c> *appends* rather than replaces, so a
/// caller that sends its own <c>X-Forwarded-For</c> puts a value of its
/// choosing at the front of the list. Keying on the first hop — which this did
/// until 2026-08-28 — let one attacker mint a fresh bucket per request by
/// changing a header, which is a rate limiter that stops nobody.
/// </summary>
public static class ClientAddress
{
    /// <summary>
    /// The partition key: the address our own proxy observed, or the transport
    /// peer when there is no proxy in front — a laptop, or the SQLite mode in
    /// the README.
    /// </summary>
    /// <param name="realIp">The <c>X-Real-IP</c> header, verbatim.</param>
    /// <param name="peer">The address the request was actually accepted from.</param>
    public static string PartitionKey(string? realIp, IPAddress? peer)
    {
        // The header counts only from a peer that could be one of ours. If this
        // server is ever reachable directly, a stranger sending `X-Real-IP`
        // must not get to pick its own bucket — and a compose file that stops
        // saying `expose` is a one-word mistake away.
        if (peer is not null && IsTrustedProxy(peer))
        {
            var forwarded = realIp?.Trim();
            if (!string.IsNullOrEmpty(forwarded)) return forwarded;
        }

        // One shared bucket rather than none: an address this server cannot
        // identify is still an address it can slow down.
        return peer?.ToString() ?? "unknown";
    }

    /// <summary>
    /// Loopback and the private ranges — everywhere a proxy of ours can live,
    /// and nowhere a caller on the internet can arrive from.
    /// </summary>
    private static bool IsTrustedProxy(IPAddress address)
    {
        if (IPAddress.IsLoopback(address)) return true;

        // Kestrel on a dual-stack socket reports a v4 peer as `::ffff:172.18.0.1`,
        // so the compose network arrives wearing a v6 address. Unwrap it before
        // deciding, or every container address reads as untrusted.
        if (address.IsIPv4MappedToIPv6) return IsTrustedProxy(address.MapToIPv4());

        var bytes = address.GetAddressBytes();

        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            return bytes[0] == 10
                || (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31)
                || (bytes[0] == 192 && bytes[1] == 168);
        }

        // fc00::/7 — unique local, the v6 equivalent of the ranges above.
        return address.AddressFamily == AddressFamily.InterNetworkV6
               && (bytes[0] & 0xFE) == 0xFC;
    }
}
