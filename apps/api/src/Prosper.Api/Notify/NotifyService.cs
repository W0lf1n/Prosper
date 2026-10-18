using System.Diagnostics.CodeAnalysis;
using Microsoft.EntityFrameworkCore;
using Prosper.Api.Data;
using Prosper.Api.Sync;

namespace Prosper.Api.Notify;

/// <summary>
/// The subscriptions, and the minute-by-minute question of which phone to wake.
///
/// The server's whole part in Upozornění: store where and when, send an empty
/// push at each when, forget a subscription the push service calls dead. What
/// the phone then says is decided on the phone, from its own ledger.
/// </summary>
public sealed class NotifyService(AppDbContext db)
{
    /// <summary>
    /// The push services a subscription may point at. The endpoint comes from
    /// a paired device, but a server that POSTs wherever it is told is a server
    /// that can be pointed at its own network — the database is one hostname
    /// away inside the compose project. So: https, and only these hosts.
    /// </summary>
    private static readonly string[] PushHosts =
    [
        "fcm.googleapis.com",          // Chrome, Edge, Samsung, Android
        "android.googleapis.com",      // older Chrome subscriptions
        ".push.services.mozilla.com",  // Firefox
        ".push.apple.com",             // Safari, the installed iPhone app
        ".notify.windows.com"          // Edge on Windows, legacy
    ];

    public static bool IsPushEndpoint([NotNullWhen(true)] string? endpoint)
    {
        if (string.IsNullOrWhiteSpace(endpoint) || endpoint.Length > NotifySubscription.EndpointMaxLength) return false;
        if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var uri)) return false;
        if (uri.Scheme != Uri.UriSchemeHttps || !uri.IsDefaultPort) return false;
        var host = uri.Host.ToLowerInvariant();
        return PushHosts.Any(allowed => allowed.StartsWith('.')
            ? host.EndsWith(allowed, StringComparison.Ordinal)
            : host == allowed);
    }

    /// <summary>Validates, then replaces this device's subscription. The reason when refused.</summary>
    public async Task<string?> SubscribeAsync(Device device, NotifySubscribeRequest request, DateTimeOffset now,
        CancellationToken ct = default)
    {
        if (!IsPushEndpoint(request.Endpoint)) return "Tohle není adresa služby pro upozornění.";
        if (string.IsNullOrEmpty(request.P256dh) || request.P256dh.Length > NotifySubscription.KeyMaxLength
            || string.IsNullOrEmpty(request.Auth) || request.Auth.Length > NotifySubscription.KeyMaxLength)
        {
            return "Chybí klíče odběru.";
        }

        var (wakes, error) = WakeList.Parse(request.Wakes, now);
        if (wakes is null) return error;

        var row = await db.NotifySubscriptions.FindAsync([device.Id], ct);
        if (row is null)
        {
            row = new NotifySubscription
            {
                DeviceId = device.Id,
                Endpoint = request.Endpoint,
                P256dh = request.P256dh,
                Auth = request.Auth,
                Wakes = ""
            };
            db.NotifySubscriptions.Add(row);
        }

        row.Endpoint = request.Endpoint;
        row.P256dh = request.P256dh;
        row.Auth = request.Auth;
        row.Wakes = WakeList.Serialize(wakes);
        row.NextWakeAt = WakeList.Next(wakes);
        row.UpdatedAt = now.ToUnixTimeMilliseconds();
        await db.SaveChangesAsync(ct);
        return null;
    }

    public async Task UnsubscribeAsync(Device device, CancellationToken ct = default)
    {
        var row = await db.NotifySubscriptions.FindAsync([device.Id], ct);
        if (row is null) return;
        db.NotifySubscriptions.Remove(row);
        await db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// One pass: every subscription whose next wake has come is sent its push
    /// (if it is not too late to be worth it), moved past now, or dropped when
    /// its push service says it is dead — or its device has been unpaired.
    /// Returns how many pushes went out.
    /// </summary>
    public async Task<int> TickAsync(IPushSender sender, DateTimeOffset now, CancellationToken ct = default)
    {
        var nowMs = now.ToUnixTimeMilliseconds();
        var due = await db.NotifySubscriptions
            .Where(s => s.NextWakeAt != null && s.NextWakeAt <= nowMs)
            .ToListAsync(ct);
        if (due.Count == 0) return 0;

        var ids = due.Select(s => s.DeviceId).ToList();
        var paired = (await db.Devices.Where(d => ids.Contains(d.Id)).Select(d => d.Id).ToListAsync(ct))
            .ToHashSet();

        var sent = 0;
        foreach (var row in due)
        {
            if (!paired.Contains(row.DeviceId))
            {
                db.NotifySubscriptions.Remove(row);
                continue;
            }

            var (send, rest) = WakeList.Take(WakeList.Deserialize(row.Wakes), now);
            row.Wakes = WakeList.Serialize(rest);
            row.NextWakeAt = WakeList.Next(rest);

            if (!send) continue;
            switch (await sender.SendAsync(row.Endpoint, ct))
            {
                case PushOutcome.Sent:
                    sent += 1;
                    break;
                case PushOutcome.Gone:
                    db.NotifySubscriptions.Remove(row);
                    break;
                case PushOutcome.Failed:
                    // Not retried: the next wake is the retry. A push service
                    // that is down at 21:00 does not get a 21:01 and a 21:02.
                    break;
            }
        }

        await db.SaveChangesAsync(ct);
        return sent;
    }

    /// <summary>
    /// The table, on a database that predates it. <c>EnsureCreated</c> builds
    /// the whole model on an empty database and does nothing at all on an
    /// existing one — so a server deployed before 2026-10-18 would never get
    /// this table from it. Plain DDL both Postgres and SQLite understand, named
    /// the way EF names it, so the two paths meet the same shape.
    /// </summary>
    public static async Task EnsureTableAsync(AppDbContext db, CancellationToken ct = default)
    {
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "notify_subscriptions" (
                "DeviceId" varchar(64) NOT NULL PRIMARY KEY,
                "Endpoint" varchar(1024) NOT NULL,
                "P256dh" varchar(128) NOT NULL,
                "Auth" varchar(128) NOT NULL,
                "Wakes" text NOT NULL,
                "NextWakeAt" bigint NULL,
                "UpdatedAt" bigint NOT NULL
            )
            """, ct);
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE INDEX IF NOT EXISTS "IX_notify_subscriptions_NextWakeAt"
                ON "notify_subscriptions" ("NextWakeAt")
            """, ct);
    }
}

/// <summary>
/// The clock behind the pushes: every thirty seconds, one <see cref="NotifyService.TickAsync"/>.
/// Registered only when VAPID keys are configured.
/// </summary>
public sealed class NotifyScheduler(IServiceScopeFactory scopes, ILogger<NotifyScheduler> log) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval);
        do
        {
            try
            {
                using var scope = scopes.CreateScope();
                var service = scope.ServiceProvider.GetRequiredService<NotifyService>();
                var sender = scope.ServiceProvider.GetRequiredService<IPushSender>();
                await service.TickAsync(sender, DateTimeOffset.UtcNow, stoppingToken);
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                // A database blip must not end the loop for good.
                log.LogError(error, "Notify tick failed");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
