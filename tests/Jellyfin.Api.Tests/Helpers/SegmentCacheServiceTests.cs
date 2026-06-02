using System;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Api.Helpers;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Api.Tests.Helpers;

public class SegmentCacheServiceTests
{
    [Fact]
    public async Task GetSegmentAsync_WhenCacheThrows_ReturnsError()
    {
        var service = new SegmentCacheService(new ThrowingDistributedCache(), NullLogger<SegmentCacheService>.Instance);

        var result = await service.GetSegmentAsync("key", CancellationToken.None);

        Assert.Equal(SegmentCacheGetStatus.Error, result.Status);
        Assert.Null(result.Bytes);
    }

    [Fact]
    public async Task SetSegmentAsync_WhenCacheThrows_ReturnsFalse()
    {
        var service = new SegmentCacheService(new ThrowingDistributedCache(), NullLogger<SegmentCacheService>.Instance);

        var stored = await service.SetSegmentAsync("key", new byte[] { 1, 2, 3 }, CancellationToken.None);

        Assert.False(stored);
    }

    private sealed class ThrowingDistributedCache : IDistributedCache
    {
        public byte[]? Get(string key) => throw new InvalidOperationException();

        public Task<byte[]?> GetAsync(string key, CancellationToken token = default)
            => throw new InvalidOperationException();

        public void Refresh(string key) => throw new InvalidOperationException();

        public Task RefreshAsync(string key, CancellationToken token = default)
            => throw new InvalidOperationException();

        public void Remove(string key) => throw new InvalidOperationException();

        public Task RemoveAsync(string key, CancellationToken token = default)
            => throw new InvalidOperationException();

        public void Set(string key, byte[] value, DistributedCacheEntryOptions options)
            => throw new InvalidOperationException();

        public Task SetAsync(string key, byte[] value, DistributedCacheEntryOptions options, CancellationToken token = default)
            => throw new InvalidOperationException();
    }
}
