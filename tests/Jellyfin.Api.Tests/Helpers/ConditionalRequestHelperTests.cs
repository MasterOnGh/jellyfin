using System;
using System.Globalization;
using Jellyfin.Api.Helpers;
using Microsoft.AspNetCore.Http;
using Xunit;

namespace Jellyfin.Api.Tests.Helpers;

public class ConditionalRequestHelperTests
{
    [Fact]
    public void ShouldReturnNotModified_WhenETagMatches_AppliesHeaders()
    {
        var context = new DefaultHttpContext();
        var lastModified = new DateTime(2026, 1, 2, 3, 4, 5, DateTimeKind.Utc);
        context.Request.Headers.IfNoneMatch = "\"abc\"";

        var notModified = ConditionalRequestHelper.ShouldReturnNotModified(context, "\"abc\"", lastModified, "no-cache");

        Assert.True(notModified);
        Assert.Equal("\"abc\"", context.Response.Headers.ETag);
        Assert.Equal("no-cache", context.Response.Headers.CacheControl);
        Assert.Equal(lastModified.ToString("R", CultureInfo.InvariantCulture), context.Response.Headers.LastModified);
    }

    [Fact]
    public void ShouldReturnNotModified_WhenValidatorsDoNotMatch_AppliesHeaders()
    {
        var context = new DefaultHttpContext();
        var lastModified = new DateTime(2026, 1, 2, 3, 4, 5, DateTimeKind.Utc);
        context.Request.Headers.IfNoneMatch = "\"old\"";
        context.Request.Headers.IfModifiedSince = lastModified.AddDays(-1).ToString("R", CultureInfo.InvariantCulture);

        var notModified = ConditionalRequestHelper.ShouldReturnNotModified(context, "\"abc\"", lastModified, "no-cache");

        Assert.False(notModified);
        Assert.Equal("\"abc\"", context.Response.Headers.ETag);
        Assert.Equal("no-cache", context.Response.Headers.CacheControl);
    }
}
