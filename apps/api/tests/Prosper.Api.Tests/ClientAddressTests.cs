using System.Net;
using Prosper.Api.Sync;
using Xunit;

namespace Prosper.Api.Tests;

/// <summary>
/// The pairing limiter is only as good as the address it counts against. These
/// tests are the record of the bug they were written for: the key used to be
/// `X-Forwarded-For`'s first hop, which the caller writes, so one attacker held
/// as many buckets as it cared to invent.
/// </summary>
public sealed class ClientAddressTests
{
    private static readonly IPAddress Proxy = IPAddress.Parse("172.18.0.1");
    private static readonly IPAddress Stranger = IPAddress.Parse("203.0.113.9");

    [Fact]
    public void TheProxysObservationIsTheKey()
    {
        Assert.Equal(
            "203.0.113.7",
            ClientAddress.PartitionKey("203.0.113.7", Proxy));
    }

    [Fact]
    public void AStrangerCannotChooseItsOwnBucket()
    {
        // The header arrives, but not from one of our proxies — so it is a
        // claim, not an observation, and the transport peer wins.
        Assert.Equal(
            "203.0.113.9",
            ClientAddress.PartitionKey("1.1.1.1", Stranger));
    }

    [Fact]
    public void ADualStackPeerIsStillTheProxy()
    {
        // Kestrel reports the compose network as `::ffff:172.18.0.1`. Reading
        // that as untrusted would send every request to the fallback and quietly
        // put the whole internet back in one bucket.
        Assert.Equal(
            "203.0.113.7",
            ClientAddress.PartitionKey("203.0.113.7", IPAddress.Parse("::ffff:172.18.0.1")));
    }

    [Theory]
    [InlineData("127.0.0.1")]
    [InlineData("::1")]
    [InlineData("10.1.2.3")]
    [InlineData("172.16.0.1")]
    [InlineData("172.31.255.255")]
    [InlineData("192.168.1.1")]
    [InlineData("fd00::1")]
    public void EveryPlaceAProxyCanLiveIsTrusted(string peer)
    {
        Assert.Equal(
            "203.0.113.7",
            ClientAddress.PartitionKey("203.0.113.7", IPAddress.Parse(peer)));
    }

    [Theory]
    [InlineData("172.15.0.1")]
    [InlineData("172.32.0.1")]
    [InlineData("11.0.0.1")]
    [InlineData("192.169.0.1")]
    public void TheEdgesOfThePrivateRangesAreNotInsideThem(string peer)
    {
        Assert.Equal(peer, ClientAddress.PartitionKey("1.1.1.1", IPAddress.Parse(peer)));
    }

    [Fact]
    public void NoHeaderFallsBackToThePeer()
    {
        Assert.Equal("172.18.0.1", ClientAddress.PartitionKey(null, Proxy));
    }

    [Fact]
    public void ABlankHeaderIsNoHeader()
    {
        Assert.Equal("172.18.0.1", ClientAddress.PartitionKey("   ", Proxy));
    }

    [Fact]
    public void AnUnidentifiableCallerSharesOneBucketRatherThanNone()
    {
        Assert.Equal("unknown", ClientAddress.PartitionKey(null, null));
    }

    [Fact]
    public void AHeaderWithoutAPeerIsStillAClaim()
    {
        // No peer means nothing to trust the header on behalf of.
        Assert.Equal("unknown", ClientAddress.PartitionKey("1.1.1.1", null));
    }
}
