using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Logging;
using Prometheus;

namespace Jellyfin.Api.Helpers;

/// <summary>
/// Redis-backed implementation of <see cref="ISegmentCacheService"/>.
/// </summary>
public sealed class SegmentCacheService : ISegmentCacheService
{
    private static readonly TimeSpan _ttl = TimeSpan.FromSeconds(45);
    private static readonly Counter _cacheReads = Metrics.CreateCounter(
        "jellyfin_hls_segment_cache_reads_total",
        "Total HLS segment cache read attempts.",
        new CounterConfiguration { LabelNames = ["result"] });

    private static readonly Counter _cacheWrites = Metrics.CreateCounter(
        "jellyfin_hls_segment_cache_writes_total",
        "Total HLS segment cache write attempts.",
        new CounterConfiguration { LabelNames = ["result"] });

    private readonly IDistributedCache _cache;
    private readonly ILogger<SegmentCacheService> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="SegmentCacheService"/> class.
    /// </summary>
    /// <param name="cache">The distributed cache instance.</param>
    /// <param name="logger">The logger.</param>
    public SegmentCacheService(IDistributedCache cache, ILogger<SegmentCacheService> logger)
    {
        _cache = cache;
        _logger = logger;
    }

    /// <inheritdoc/>
    public async Task<SegmentCacheGetResult> GetSegmentAsync(string cacheKey, CancellationToken cancellationToken)
    {
        try
        {
            var bytes = await _cache.GetAsync(cacheKey, cancellationToken).ConfigureAwait(false);
            if (bytes is null)
            {
                _cacheReads.WithLabels("miss").Inc();
                return SegmentCacheGetResult.Miss;
            }

            _cacheReads.WithLabels("hit").Inc();
            return SegmentCacheGetResult.Hit(bytes);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _cacheReads.WithLabels("error").Inc();
            _logger.LogWarning(ex, "Failed to read HLS segment from Redis cache.");
            return SegmentCacheGetResult.Error;
        }
    }

    /// <inheritdoc/>
    public async Task<bool> SetSegmentAsync(string cacheKey, byte[] data, CancellationToken cancellationToken)
    {
        try
        {
            await _cache.SetAsync(
                    cacheKey,
                    data,
                    new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = _ttl },
                    cancellationToken)
                .ConfigureAwait(false);

            _cacheWrites.WithLabels("stored").Inc();
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _cacheWrites.WithLabels("error").Inc();
            _logger.LogWarning(ex, "Failed to write HLS segment to Redis cache.");
            return false;
        }
    }
}
