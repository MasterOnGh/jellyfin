using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Server;

/// <summary>
/// Verifies Redis connectivity at startup when segment caching is configured.
/// Stops the application if Redis is unreachable.
/// </summary>
public sealed class RedisSegmentCacheStartupValidator : IHostedService
{
    private readonly IDistributedCache _cache;
    private readonly ILogger<RedisSegmentCacheStartupValidator> _logger;
    private readonly IHostApplicationLifetime _lifetime;

    /// <summary>
    /// Initializes a new instance of the <see cref="RedisSegmentCacheStartupValidator"/> class.
    /// </summary>
    /// <param name="cache">The distributed cache to probe.</param>
    /// <param name="logger">The logger instance.</param>
    /// <param name="lifetime">The application lifetime.</param>
    public RedisSegmentCacheStartupValidator(
        IDistributedCache cache,
        ILogger<RedisSegmentCacheStartupValidator> logger,
        IHostApplicationLifetime lifetime)
    {
        _cache = cache;
        _logger = logger;
        _lifetime = lifetime;
    }

    /// <inheritdoc/>
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            await _cache.GetAsync("__probe__", cancellationToken).ConfigureAwait(false);
            _logger.LogInformation("Redis segment cache connected successfully.");
        }
        catch (Exception ex)
        {
            _logger.LogCritical(ex, "Redis segment cache is configured but unreachable. Stopping server.");
            _lifetime.StopApplication();
        }
    }

    /// <inheritdoc/>
    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
