using System.Threading;
using System.Threading.Tasks;

namespace Jellyfin.Api.Helpers;

/// <summary>
/// Service for caching HLS transcoded segments.
/// </summary>
public interface ISegmentCacheService
{
    /// <summary>
    /// Retrieves cached segment bytes, or null if not cached.
    /// </summary>
    /// <param name="cacheKey">The content-based segment cache key.</param>
    /// <param name="cancellationToken">The cancellation token.</param>
    /// <returns>The cache read result.</returns>
    Task<SegmentCacheGetResult> GetSegmentAsync(string cacheKey, CancellationToken cancellationToken);

    /// <summary>
    /// Stores segment bytes in the cache.
    /// </summary>
    /// <param name="cacheKey">The content-based segment cache key.</param>
    /// <param name="data">The segment bytes to cache.</param>
    /// <param name="cancellationToken">The cancellation token.</param>
    /// <returns>True when the segment was stored; otherwise false.</returns>
    Task<bool> SetSegmentAsync(string cacheKey, byte[] data, CancellationToken cancellationToken);
}
