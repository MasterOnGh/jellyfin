using System;
using System.Globalization;
using Microsoft.AspNetCore.Http;
using Prometheus;

namespace Jellyfin.Api.Helpers;

/// <summary>
/// Helpers for applying HTTP conditional request headers consistently.
/// </summary>
public static class ConditionalRequestHelper
{
    private static readonly Counter _conditionalRequests = Metrics.CreateCounter(
        "jellyfin_api_conditional_requests_total",
        "Total API conditional request evaluations.",
        new CounterConfiguration { LabelNames = ["result"] });

    /// <summary>
    /// Applies ETag, Last-Modified, and Cache-Control headers and determines whether a 304 response should be returned.
    /// </summary>
    /// <param name="context">The HTTP context.</param>
    /// <param name="eTag">The quoted ETag value.</param>
    /// <param name="lastModified">The last modified time.</param>
    /// <param name="cacheControl">The Cache-Control header value.</param>
    /// <returns>True when the request matches the supplied validators.</returns>
    public static bool ShouldReturnNotModified(HttpContext context, string eTag, DateTime lastModified, string cacheControl)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentException.ThrowIfNullOrEmpty(eTag);
        ArgumentException.ThrowIfNullOrEmpty(cacheControl);

        var normalizedLastModified = lastModified.ToUniversalTime();
        if (string.Equals(context.Request.Headers.IfNoneMatch.ToString(), eTag, StringComparison.Ordinal))
        {
            ApplyHeaders(context, eTag, normalizedLastModified, cacheControl);
            _conditionalRequests.WithLabels("not_modified").Inc();
            return true;
        }

        if (DateTime.TryParse(context.Request.Headers.IfModifiedSince.ToString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var ifModifiedSince)
            && normalizedLastModified <= ifModifiedSince.ToUniversalTime())
        {
            ApplyHeaders(context, eTag, normalizedLastModified, cacheControl);
            _conditionalRequests.WithLabels("not_modified").Inc();
            return true;
        }

        ApplyHeaders(context, eTag, normalizedLastModified, cacheControl);
        _conditionalRequests.WithLabels("modified").Inc();
        return false;
    }

    private static void ApplyHeaders(HttpContext context, string eTag, DateTime lastModified, string cacheControl)
    {
        context.Response.Headers.ETag = eTag;
        context.Response.Headers.LastModified = lastModified.ToString("R", CultureInfo.InvariantCulture);
        context.Response.Headers.CacheControl = cacheControl;
    }
}
