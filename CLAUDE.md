# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build
dotnet build

# Run (requires separate jellyfin-web build or installation)
dotnet run --project Jellyfin.Server --webdir /absolute/path/to/jellyfin-web/dist

# Run without web client
dotnet run --project Jellyfin.Server --nowebclient

# Publish a self-contained executable (Windows x64)
dotnet publish Jellyfin.Server --configuration Release --runtime win-x64 --self-contained true --output publish/win-x64

# Run all tests
dotnet test Jellyfin.sln

# Run a single test project
dotnet test tests/Jellyfin.Api.Tests

# Run tests with coverage (matches CI)
dotnet test Jellyfin.sln --configuration Release --collect:"XPlat Code Coverage" --settings tests/coverletArgs.runsettings --verbosity minimal

# Check formatting (matches CI)
dotnet format --verify-no-changes --verbosity minimal

# Apply formatting fixes
dotnet format

# EF Core migrations (SQLite provider)
dotnet tool restore
dotnet ef migrations add {MIGRATION_NAME} --project "src/Jellyfin.Database/Jellyfin.Database.Providers.Sqlite" --output-dir Migrations -- --migration-provider Jellyfin-SQLite
```

## Architecture

Jellyfin is an ASP.NET Core (.NET 10) media server. The codebase uses a layered architecture:

**Interface layer** (`MediaBrowser.Controller`, `MediaBrowser.Common`, `MediaBrowser.Model`): defines contracts, interfaces, and shared DTOs. No concrete implementations here.

**Implementation layer**: split across two projects by historical convention:
- `Emby.Server.Implementations/` — library management, sessions, scheduling, DI wiring (`ApplicationHost.cs`), user management, plugins
- `Jellyfin.Server.Implementations/` — newer implementations, item persistence via EF Core

**API layer** (`Jellyfin.Api/`): ASP.NET Core controllers, custom auth handlers, middleware, model binders. All controllers extend `BaseJellyfinApiController`.

**Entry point** (`Jellyfin.Server/`): Kestrel host setup (`Program.cs`, `Startup.cs`), startup migrations, health checks. `CoreAppHost` (in `Emby.Server.Implementations/`) wires all services together.

**Subsystem projects under `src/`**:
- `Jellyfin.Database/` — EF Core DbContext with multi-provider support (SQLite default, experimental PostgreSQL). Each provider has its own migrations directory.
- `Jellyfin.Drawing` / `Jellyfin.Drawing.Skia` — image processing (`ImageProcessor.cs`)
- `Jellyfin.LiveTv` — live TV channel/recording support
- `Jellyfin.Networking` — network interface management, Happy Eyeballs HTTP
- `Jellyfin.MediaEncoding.Hls` / `Jellyfin.MediaEncoding.Keyframes` — HLS playlist generation and keyframe extraction
- `Jellyfin.Extensions` — shared utility extensions
- `Jellyfin.CodeAnalysis` — custom Roslyn analyzers (applied to all other projects in Debug builds)

**Other top-level projects**:
- `MediaBrowser.Providers/` — metadata providers (TMDB, MusicBrainz, ListenBrainz, etc.)
- `MediaBrowser.MediaEncoding/` — FFmpeg transcoding, subtitle handling, BDInfo
- `MediaBrowser.LocalMetadata/` / `MediaBrowser.XbmcMetadata/` — NFO/XML metadata file parsers
- `Emby.Naming/` — media file name resolution and parsing
- `Emby.Photos/` — photo library support

**Web folder**:
- `jellyfin-web` - main folder for the web - not touch or read because that useless. It needs to stay this way.

**Test projects** (`tests/`) mirror the structure of the main projects and use xUnit.

## Code Quality Constraints

- **All warnings are errors** (`TreatWarningsAsErrors=true`). Debug builds additionally enable `AllEnabledByDefault` analysis.
- **Nullable reference types are enabled** everywhere (`<Nullable>enable</Nullable>` in `Directory.Build.props`), **except** `MediaBrowser.Model/Configuration/EncodingOptions.cs` which has `#nullable disable` at the top — use `string` (not `string?`) for any new properties there. Similarly, `Emby.Server.Implementations/` does not have a project-wide nullable context — avoid `?` annotations there unless the file individually opts in.
- **Banned APIs** (see `BannedSymbols.txt`): `Task<T>.Result` (use `await`), `Guid ==`/`!=`/`Equals(Object)` operators (use `Guid.Equals(Guid)` instead). Note: `ActionResult<T>.Result` is NOT banned — it is the `ActionResult` unwrap property, not `Task<T>.Result`.
- **StyleCop** is enforced via `stylecop.json`; files must end with a newline.
- Always use `.ConfigureAwait(false)` on awaited calls throughout the server codebase.
- **Package versions are centrally managed** in `Directory.Packages.props` (`ManagePackageVersionsCentrally=true`). Individual `.csproj` files reference packages without version numbers; add new versions to `Directory.Packages.props` first.

## Web Responsiveness (implemented)

`Jellyfin.Server/Startup.cs` configures:
- **Brotli + Gzip compression** with explicit MIME types (`application/json`, `text/css`, `application/javascript`, `image/svg+xml`, `application/x-mpegURL`) and `CompressionLevel.Fastest`.
- **Static file caching**: `index.html` → `no-cache, no-store, must-revalidate`; all other web assets → `public, max-age=31536000, immutable`.

**ETag / HTTP caching on API endpoints** — the following pattern (from `LibraryController.GetMediaFolders`) is replicated on all major collection endpoints:
- `ETag` = `"{totalCount:x}-{maxDateModified.Ticks:x}"` — changes when items are added/updated.
- Returns `304 Not Modified` on `If-None-Match` or `If-Modified-Since` match.
- `Cache-Control: no-cache` (revalidate on every request, but skip body on match).
- Endpoints covered: `GetMediaFolders`, `GetArtists`, `GetAlbumArtists`, `GetGenres`, `GetPersons`, `GetStudios`.

**Aggressive caching for static data** — endpoints whose data never changes at runtime return `Cache-Control: public, max-age=86400`:
- `LocalizationController`: `GetCultures`, `GetCountries`, `GetParentalRatings`, `GetLocalizationOptions`
- `SessionController`: `GetAuthProviders`, `GetPasswordResetProviders`

**HLS master playlist ETag** — `DynamicHlsHelper.GetMasterPlaylistInternal()` computes an MD5 ETag of the generated playlist body and returns `304` on match. The old `Expires: 0` header has been removed.

## HLS Segment Cache (Redis, optional)

Segments produced by FFmpeg can be cached in Redis for 45 seconds to avoid repeated disk reads across multiple clients watching the same content.

**Key files:**
- `Jellyfin.Api/Helpers/ISegmentCacheService.cs` — interface
- `Jellyfin.Api/Helpers/SegmentCacheService.cs` — Redis implementation via `IDistributedCache` (TTL 45 s)
- `Jellyfin.Api/Helpers/NullSegmentCacheService.cs` — no-op when Redis is not configured
- `Jellyfin.Server/RedisSegmentCacheStartupValidator.cs` — `IHostedService` that probes Redis at startup and stops the app if unreachable
- `Jellyfin.Api/Controllers/DynamicHlsController.cs` — `BuildSegmentCacheKey()` + cache check/store integrated into `GetSegmentResultAsync()`

**Cache key** is a content-based MD5 hash of `{mediaPath}-{segmentContainer}-{videoCodec}-{videoBitRate}-{audioCodec}-{audioBitRate}-{maxWidth}-{maxHeight}-{subtitleMethod}-{segmentIndex}`, prefixed with `hls:seg:`. This allows different client sessions watching the same file at the same quality to share cached segments.

**Flow**: cache miss → serve from disk via `PhysicalFileResult`, then store bytes in Redis via `Response.OnCompleted` (fire-and-forget). Cache hit → return `FileContentResult` from Redis.

**Activation**: add `<RedisSegmentCacheConnectionString>localhost:6379</RedisSegmentCacheConnectionString>` to `config/encoding.xml`. If the key is absent or empty, `NullSegmentCacheService` is used transparently.

## HLS Segment Availability (implemented)

`Jellyfin.Api/Helpers/HlsHelpers.WaitForMinimumSegmentCount()` uses a `FileSystemWatcher` + `SemaphoreSlim` instead of `Task.Delay` polling. The watcher signals the semaphore immediately when FFmpeg writes the `.m3u8` playlist file; a 2-second fallback timeout handles missed events. This reduces segment-start latency by 50–100 ms compared to the previous fixed-delay approach.

## Image Processing Cache (implemented)

`src/Jellyfin.Drawing/ImageProcessor.cs` injects `IMemoryCache` and caches processed image results for **5 minutes (sliding)**. The cache key is `cacheFilePath`, which is already the MD5 of all encoding parameters (dimensions, format, quality, etc.). This avoids `File.Exists` + `GetLastWriteTimeUtc` disk calls on every image request for the same parameters.

## Database Performance Patterns

**Always use `.AsNoTracking()`** on read-only EF Core queries that only extract IDs or scalar values (e.g., filtering subqueries in `BaseItemRepository.TranslateQuery.cs`). Change tracking on ID-extraction queries wastes memory with no benefit.

**Avoid `.All(f => f.Navigation.Any(...))` patterns** — EF Core translates these to N correlated subqueries. Use two aggregate `COUNT` queries instead (see `BaseItemRepository.GetIsPlayed()`).

**Prefer `.All()` over `!.Any(e => !...)`** — the double-negation form generates more complex SQL. They are logically identical but `All()` often produces a better query plan.

**Use `HashSet<T>` for `.Contains()` on collections** that are used as in-memory filters (e.g., `topSeriesNames` in `GetLatestTvShowItems()`).

**Batch existence checks** — `UserDataManager.SaveUserData()` pre-fetches all existing `CustomDataKey` values in a single query before the loop, rather than calling `Any(...)` per key.

## FFmpeg / Thumbnail Extraction (implemented)

`MediaBrowser.MediaEncoding/Encoder/MediaEncoder.cs` uses a dedicated `_thumbnailResourcePool` semaphore whose size is controlled by `ServerConfiguration.ParallelThumbnailExtractionLimit` (default: `Environment.ProcessorCount * 2`). This is intentionally higher than `ParallelImageEncodingLimit` because FFmpeg extraction is I/O-bound (reads video, writes JPEG), not CPU-bound like Skia image encoding.

## Library Scan (implemented)

`Emby.Server.Implementations/Library/LibraryManager.RunPostScanTasks()` runs all post-scan tasks (genre cleanup, person validation, playlist validation, etc.) in parallel via `Task.WhenAll`. Each task has its own exception handler so a single failure does not abort the others. `UpdateInheritedValues()` is called after all tasks complete.

## Session Management (implemented)

`Emby.Server.Implementations/Session/SessionManager.cs` timer callbacks (`CheckForIdlePlayback`, `CheckForInactiveSteams`) are `void` — they delegate immediately to `async Task` methods (`CheckForIdlePlaybackAsync`, `CheckForInactiveStreamsAsync`). This avoids the `async void` anti-pattern where exceptions are unobservable. The timer callbacks use the pattern `_ = CheckForXAsync()` (fire-and-forget from a non-async context).

## Database Migrations

When adding EF Core schema changes, migrations must be created for **every supported provider** — currently only SQLite. Run the migration command from the repo root. If `dotnet-ef` is missing, run `dotnet tool restore` first.
