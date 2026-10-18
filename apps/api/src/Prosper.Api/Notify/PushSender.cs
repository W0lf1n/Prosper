namespace Prosper.Api.Notify;

public enum PushOutcome
{
    /// <summary>The push service took it.</summary>
    Sent,

    /// <summary>The subscription is dead (404/410): the phone unsubscribed or was wiped.</summary>
    Gone,

    /// <summary>Anything else — the service is down, throttling, or we are offline.</summary>
    Failed
}

public interface IPushSender
{
    Task<PushOutcome> SendAsync(string endpoint, CancellationToken ct);
}

/// <summary>
/// One empty push, signed. Web Push without a body needs no encryption and
/// no content headers: an <c>Authorization</c>, a <c>TTL</c>, an
/// <c>Urgency</c>, and a zero-length POST to the subscription's endpoint.
/// </summary>
public sealed class WebPushSender(HttpClient http, Vapid vapid, ILogger<WebPushSender> log) : IPushSender
{
    /// <summary>
    /// How long the push service may hold it for a phone that is off. An hour:
    /// an evening question delivered the next morning is not one worth asking.
    /// </summary>
    private const int TimeToLiveSeconds = 60 * 60;

    public async Task<PushOutcome> SendAsync(string endpoint, CancellationToken ct)
    {
        var uri = new Uri(endpoint);
        using var request = new HttpRequestMessage(HttpMethod.Post, uri)
        {
            Content = new ByteArrayContent([])
        };
        request.Headers.TryAddWithoutValidation("Authorization", vapid.AuthorizationFor(uri, DateTimeOffset.UtcNow));
        request.Headers.Add("TTL", TimeToLiveSeconds.ToString(System.Globalization.CultureInfo.InvariantCulture));
        // `high` is what gets a doze-mode Android to wake on the minute. It is
        // a notice he asked for at a time he chose, which is what it is for.
        request.Headers.Add("Urgency", "high");

        try
        {
            using var response = await http.SendAsync(request, ct);
            var status = (int)response.StatusCode;
            if (response.IsSuccessStatusCode) return PushOutcome.Sent;
            if (status is 404 or 410) return PushOutcome.Gone;
            // The host only: the full endpoint is a capability URL.
            log.LogWarning("Push to {Host} refused: {Status}", uri.Host, status);
            return PushOutcome.Failed;
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException)
        {
            log.LogWarning("Push to {Host} failed: {Message}", uri.Host, error.Message);
            return PushOutcome.Failed;
        }
    }
}
