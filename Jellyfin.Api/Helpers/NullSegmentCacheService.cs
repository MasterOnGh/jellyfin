using System.Threading;
using System.Threading.Tasks;

namespace Jellyfin.Api.Helpers;

/// <summary>
/// No-op implementation of <see cref="ISegmentCacheService"/> used when Redis is not configured.
/// </summary>
public sealed class NullSegmentCacheService : ISegmentCacheService
{
    /// <inheritdoc/>
    public Task<SegmentCacheGetResult> GetSegmentAsync(string cacheKey, CancellationToken cancellationToken)
        => Task.FromResult(SegmentCacheGetResult.Miss);

    /// <inheritdoc/>
    public Task<bool> SetSegmentAsync(string cacheKey, byte[] data, CancellationToken cancellationToken)
        => Task.FromResult(false);
}
