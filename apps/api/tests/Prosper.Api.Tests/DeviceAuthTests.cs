using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Prosper.Api.Data;
using Prosper.Api.Sync;
using Xunit;

namespace Prosper.Api.Tests;

public sealed class DeviceAuthTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly AppDbContext _db;
    private readonly DeviceAuth _auth;

    public DeviceAuthTests()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(_connection)
            .Options);
        _db.Database.EnsureCreated();
        _auth = new DeviceAuth(_db);
    }

    public void Dispose()
    {
        _db.Dispose();
        _connection.Dispose();
    }

    [Fact]
    public async Task Pairing_returns_a_token_and_never_stores_it()
    {
        var result = await _auth.PairAsync("Telefon");

        Assert.NotEmpty(result.Token);
        var stored = await _db.Devices.SingleAsync();
        // A database dump must not hand anybody a working device.
        Assert.DoesNotContain(result.Token, stored.TokenHash);
        Assert.Equal(DeviceAuth.Hash(result.Token), stored.TokenHash);
    }

    [Fact]
    public async Task Pairing_cuts_a_name_to_the_column()
    {
        var result = await _auth.PairAsync(new string('n', 300));

        var stored = await _db.Devices.SingleAsync(d => d.Id == result.DeviceId);
        Assert.Equal(Device.NameMaxLength, stored.Name.Length);
    }

    [Theory]
    [InlineData("  Telefon  ", "Telefon")]
    [InlineData("", "Zařízení")]
    [InlineData("   ", "Zařízení")]
    [InlineData(null, "Zařízení")]
    public void A_name_is_trimmed_and_defaulted(string? given, string expected)
    {
        Assert.Equal(expected, DeviceAuth.Fit(given));
    }

    [Fact]
    public void The_cut_never_splits_an_emoji()
    {
        // 119 plain characters, then a two-unit emoji straddling the edge.
        var name = new string('n', Device.NameMaxLength - 1) + "\U0001F4B0" + "tail";

        var fitted = DeviceAuth.Fit(name);

        Assert.Equal(Device.NameMaxLength - 1, fitted.Length);
        Assert.False(char.IsHighSurrogate(fitted[^1]));
    }

    [Fact]
    public async Task A_token_resolves_to_its_device()
    {
        var paired = await _auth.PairAsync("Telefon");

        var device = await _auth.ResolveAsync($"Bearer {paired.Token}");

        Assert.NotNull(device);
        Assert.Equal(paired.DeviceId, device!.Id);
        Assert.NotNull(device.LastSeenAt);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Bearer ")]
    [InlineData("Basic abc")]
    [InlineData("Bearer wrong-token")]
    public async Task Anything_else_resolves_to_nobody(string? header)
    {
        Assert.Null(await _auth.ResolveAsync(header));
    }

    [Fact]
    public void Two_tokens_are_never_the_same()
    {
        var tokens = Enumerable.Range(0, 200).Select(_ => DeviceAuth.NewToken()).ToHashSet();

        Assert.Equal(200, tokens.Count);
    }

    [Theory]
    [InlineData("123456", "123456", true)]
    [InlineData("123456", "123457", false)]
    [InlineData("123456", "", false)]
    [InlineData("123456", "1234567", false)]
    public void The_pairing_code_compares_exactly(string expected, string given, bool matches)
    {
        Assert.Equal(matches, DeviceAuth.CodeMatches(expected, given));
    }
}
