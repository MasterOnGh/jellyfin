namespace Jellyfin.Api.Helpers;

/// <summary>
/// The segment cache read status.
/// </summary>
public enum SegmentCacheGetStatus
{
    /// <summary>
    /// The segment was found.
    /// </summary>
    Hit,

    /// <summary>
    /// The segment was not found.
    /// </summary>
    Miss,

    /// <summary>
    /// The cache backend failed.
    /// </summary>
    Error
}
