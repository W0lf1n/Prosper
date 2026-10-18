using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Prosper.Api.Data;
using Prosper.Api.Notify;
using Prosper.Api.Sync;
using Xunit;

namespace Prosper.Api.Tests;

public sealed class VapidTests
{
    [Fact]
    public void A_generated_pair_loads_and_signs_a_token_its_public_half_verifies()
    {
        var (publicKey, privateKey) = Vapid.Generate();
        var vapid = Vapid.FromConfig(publicKey, privateKey, "mailto:petr@example.cz")!;
        var now = DateTimeOffset.FromUnixTimeSeconds(1_790_000_000);

        var header = vapid.AuthorizationFor(new Uri("https://fcm.googleapis.com/fcm/send/abc"), now);

        Assert.StartsWith("vapid t=", header);
        Assert.EndsWith($", k={publicKey}", header);
        var token = header["vapid t=".Length..header.IndexOf(", k=", StringComparison.Ordinal)];
        var parts = token.Split('.');
        Assert.Equal(3, parts.Length);

        // The push service's side of it: the signature over header.claims, with the public point.
        var point = Base64Url.DecodeFromChars(publicKey);
        using var verifier = ECDsa.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            Q = new ECPoint { X = point[1..33], Y = point[33..65] }
        });
        Assert.True(verifier.VerifyData(
            Encoding.ASCII.GetBytes($"{parts[0]}.{parts[1]}"),
            Base64Url.DecodeFromChars(parts[2]),
            HashAlgorithmName.SHA256));

        using var claims = JsonDocument.Parse(Base64Url.DecodeFromChars(parts[1]));
        Assert.Equal("https://fcm.googleapis.com", claims.RootElement.GetProperty("aud").GetString());
        Assert.Equal("mailto:petr@example.cz", claims.RootElement.GetProperty("sub").GetString());
        Assert.Equal((now + Vapid.Lifetime).ToUnixTimeSeconds(), claims.RootElement.GetProperty("exp").GetInt64());
    }

    [Fact]
    public void No_keys_is_no_push_rather_than_an_error()
    {
        Assert.Null(Vapid.FromConfig(null, null, null));
        Assert.Null(Vapid.FromConfig("", "  ", "mailto:x@y.z"));
    }

    [Fact]
    public void A_key_of_the_wrong_shape_stops_the_server_with_a_sentence()
    {
        var error = Assert.Throws<InvalidOperationException>(() => Vapid.FromConfig("AAAA", "AAAA", null));
        Assert.Contains("vapid", error.Message);
    }
}

public sealed class WakeListTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 18, 19, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Instants_are_kept_sorted_and_once_and_the_past_is_dropped()
    {
        var (wakes, error) = WakeList.Parse(
        [
            "2026-10-19T19:00:00.000Z",
            "2026-10-18T20:00:00.000Z",
            "2026-10-18T18:00:00.000Z",
            "2026-10-19T19:00:00.000Z",
            // 19:00 UTC, which is now: not in the future, so not kept.
            "2026-10-18T21:00:00+02:00"
        ], Now);

        Assert.Null(error);
        Assert.Equal(
            [
                new DateTimeOffset(2026, 10, 18, 20, 0, 0, TimeSpan.Zero).ToUnixTimeMilliseconds(),
                new DateTimeOffset(2026, 10, 19, 19, 0, 0, TimeSpan.Zero).ToUnixTimeMilliseconds()
            ],
            wakes!);
    }

    [Fact]
    public void A_list_that_is_not_instants_is_refused_whole()
    {
        Assert.NotNull(WakeList.Parse(["zítra večer"], Now).Error);
        Assert.NotNull(WakeList.Parse(["2026-10-19"], Now).Error);
    }

    [Fact]
    public void A_list_that_is_too_long_is_refused()
    {
        var many = Enumerable.Range(1, WakeList.MaxWakes + 1)
            .Select(h => Now.AddHours(h).ToString("O"))
            .ToList();
        Assert.NotNull(WakeList.Parse(many, Now).Error);
    }

    [Fact]
    public void Due_wakes_collapse_into_one_push_and_leave_the_list()
    {
        long At(int minutes) => Now.AddMinutes(minutes).ToUnixTimeMilliseconds();

        var (send, remaining) = WakeList.Take([At(-5), At(0), At(60)], Now);

        Assert.True(send);
        Assert.Equal([At(60)], remaining);
    }

    [Fact]
    public void A_wake_missed_by_more_than_the_grace_is_dropped_without_a_push()
    {
        long At(int minutes) => Now.AddMinutes(minutes).ToUnixTimeMilliseconds();

        var (send, remaining) = WakeList.Take([At(-120), At(60)], Now);

        Assert.False(send);
        Assert.Equal([At(60)], remaining);
    }

    [Fact]
    public void The_stored_form_round_trips()
    {
        long[] wakes = [1_790_000_000_000, 1_790_086_400_000];
        Assert.Equal(wakes, WakeList.Deserialize(WakeList.Serialize(wakes)));
        Assert.Empty(WakeList.Deserialize(""));
    }
}

public sealed class NotifyServiceTests : IDisposable
{
    private static readonly DateTimeOffset Now = new(2026, 10, 18, 19, 0, 0, TimeSpan.Zero);
    private const string Endpoint = "https://fcm.googleapis.com/fcm/send/abc:def";

    private readonly SqliteConnection _connection;
    private readonly AppDbContext _db;
    private readonly NotifyService _notify;

    public NotifyServiceTests()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(_connection).Options);
        _db.Database.EnsureCreated();
        _notify = new NotifyService(_db);
    }

    public void Dispose()
    {
        _db.Dispose();
        _connection.Dispose();
    }

    private sealed class FakeSender(PushOutcome outcome = PushOutcome.Sent) : IPushSender
    {
        public List<string> Sent { get; } = [];

        public Task<PushOutcome> SendAsync(string endpoint, CancellationToken ct)
        {
            Sent.Add(endpoint);
            return Task.FromResult(outcome);
        }
    }

    private async Task<Device> PairedAsync()
    {
        var device = new Device { Id = Guid.NewGuid().ToString("N"), Name = "Telefon", TokenHash = Guid.NewGuid().ToString() };
        _db.Devices.Add(device);
        await _db.SaveChangesAsync();
        return device;
    }

    private static NotifySubscribeRequest Request(params string[] wakes) =>
        new(Endpoint, "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", "tBHItJI5svbpez7KI4CCXg", wakes);

    [Theory]
    [InlineData("https://fcm.googleapis.com/fcm/send/x", true)]
    [InlineData("https://updates.push.services.mozilla.com/wpush/v2/x", true)]
    [InlineData("https://web.push.apple.com/QGuQ", true)]
    [InlineData("http://fcm.googleapis.com/fcm/send/x", false)]
    [InlineData("https://fcm.googleapis.com:8443/fcm/send/x", false)]
    [InlineData("https://db:5432/", false)]
    [InlineData("https://evil.example/fcm.googleapis.com", false)]
    [InlineData("https://fcm.googleapis.com.evil.example/x", false)]
    [InlineData("https://notpush.apple.com/x", false)]
    [InlineData(null, false)]
    public void Only_a_push_service_may_be_the_endpoint(string? endpoint, bool allowed)
    {
        Assert.Equal(allowed, NotifyService.IsPushEndpoint(endpoint));
    }

    [Fact]
    public async Task A_subscription_is_one_per_device_and_a_second_replaces_it()
    {
        var device = await PairedAsync();

        Assert.Null(await _notify.SubscribeAsync(device, Request("2026-10-18T21:00:00Z"), Now));
        Assert.Null(await _notify.SubscribeAsync(device, Request("2026-10-19T07:00:00Z", "2026-10-19T19:00:00Z"), Now));

        var row = await _db.NotifySubscriptions.SingleAsync();
        Assert.Equal(new DateTimeOffset(2026, 10, 19, 7, 0, 0, TimeSpan.Zero).ToUnixTimeMilliseconds(), row.NextWakeAt);
        Assert.Equal(2, WakeList.Deserialize(row.Wakes).Length);
    }

    [Fact]
    public async Task A_bad_endpoint_or_missing_keys_are_refused_with_a_sentence()
    {
        var device = await PairedAsync();

        Assert.NotNull(await _notify.SubscribeAsync(device, Request() with { Endpoint = "https://db/" }, Now));
        Assert.NotNull(await _notify.SubscribeAsync(device, Request() with { Auth = null }, Now));
        Assert.Empty(await _db.NotifySubscriptions.ToListAsync());
    }

    [Fact]
    public async Task A_due_wake_is_one_push_and_the_next_one_waits()
    {
        var device = await PairedAsync();
        await _notify.SubscribeAsync(device, Request("2026-10-18T19:00:30Z", "2026-10-19T19:00:00Z"), Now);
        var sender = new FakeSender();

        Assert.Equal(0, await _notify.TickAsync(sender, Now));
        Assert.Equal(1, await _notify.TickAsync(sender, Now.AddMinutes(1)));
        Assert.Equal(0, await _notify.TickAsync(sender, Now.AddMinutes(2)));

        Assert.Equal([Endpoint], sender.Sent);
        var row = await _db.NotifySubscriptions.SingleAsync();
        Assert.Equal(new DateTimeOffset(2026, 10, 19, 19, 0, 0, TimeSpan.Zero).ToUnixTimeMilliseconds(), row.NextWakeAt);
    }

    [Fact]
    public async Task A_subscription_its_service_calls_dead_is_forgotten()
    {
        var device = await PairedAsync();
        await _notify.SubscribeAsync(device, Request("2026-10-18T19:00:30Z", "2026-10-19T19:00:00Z"), Now);

        await _notify.TickAsync(new FakeSender(PushOutcome.Gone), Now.AddMinutes(1));

        Assert.Empty(await _db.NotifySubscriptions.ToListAsync());
    }

    [Fact]
    public async Task An_unpaired_device_is_woken_no_more()
    {
        var device = await PairedAsync();
        await _notify.SubscribeAsync(device, Request("2026-10-18T19:00:30Z"), Now);
        _db.Devices.Remove(device);
        await _db.SaveChangesAsync();
        var sender = new FakeSender();

        await _notify.TickAsync(sender, Now.AddMinutes(1));

        Assert.Empty(sender.Sent);
        Assert.Empty(await _db.NotifySubscriptions.ToListAsync());
    }

    [Fact]
    public async Task Unsubscribing_removes_the_row()
    {
        var device = await PairedAsync();
        await _notify.SubscribeAsync(device, Request("2026-10-18T21:00:00Z"), Now);

        await _notify.UnsubscribeAsync(device);
        await _notify.UnsubscribeAsync(device);

        Assert.Empty(await _db.NotifySubscriptions.ToListAsync());
    }

    [Fact]
    public async Task The_table_arrives_on_a_database_built_before_it()
    {
        // A database from before 2026-10-18: everything but this table.
        await _db.Database.ExecuteSqlRawAsync("""DROP TABLE "notify_subscriptions" """);

        await NotifyService.EnsureTableAsync(_db);
        await NotifyService.EnsureTableAsync(_db); // and twice is harmless

        var device = await PairedAsync();
        Assert.Null(await _notify.SubscribeAsync(device, Request("2026-10-18T21:00:00Z"), Now));
        Assert.Single(await _db.NotifySubscriptions.ToListAsync());
    }
}
