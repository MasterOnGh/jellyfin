namespace Jellyfin.Api.Helpers;

/// <summary>
/// The outcome of a segment cache read.
/// </summary>
/// <param name="Status">The cache read status.</param>
/// <param name="Bytes">The cached segment bytes, when available.</param>
public sealed record SegmentCacheGetResult(SegmentCacheGetStatus Status, byte[]? Bytes)
{
    /// <summary>
    /// Gets a cache miss result.
    /// </summary>
    public static SegmentCacheGetResult Miss { get; } = new(SegmentCacheGetStatus.Miss, null);

    /// <summary>
    /// Gets an error result.
    /// </summary>
    public static SegmentCacheGetResult Error { get; } = new(SegmentCacheGetStatus.Error, null);

    /// <summary>
    /// Creates a cache hit result.
    /// </summary>
    /// <param name="bytes">The cached bytes.</param>
    /// <returns>The cache hit result.</returns>
    public static SegmentCacheGetResult Hit(byte[] bytes) => new(SegmentCacheGetStatus.Hit, bytes);
}
