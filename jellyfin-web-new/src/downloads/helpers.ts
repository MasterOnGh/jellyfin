import type {
    DownloadErrorCode,
    DownloadProfileScope,
    DownloadRecord,
    DownloadScope,
    DownloadStatus
} from './types';

const AUTH_QUERY_PARAMETERS = new Set([
    'access_token',
    'api_key',
    'apikey',
    'token',
    'x-emby-token'
]);

const DOWNLOAD_ID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

const DOWNLOAD_STATUSES = new Set<DownloadStatus>([
    'completed',
    'downloading',
    'failed',
    'paused'
]);

const DOWNLOAD_ERROR_CODES = new Set<DownloadErrorCode>([
    'aborted',
    'authentication',
    'http',
    'incomplete',
    'network',
    'not_found',
    'quota',
    'storage',
    'unsupported',
    'unknown'
]);

export const DOWNLOAD_DIRECTORY = 'jellyfin-web-new-downloads';
export const DOWNLOAD_DATABASE = 'jellyfin-web-new-downloads';
export const DOWNLOAD_OBJECT_STORE = 'metadata';
export const DOWNLOAD_METADATA_VERSION = 'v1';
export const PROGRESS_WRITE_INTERVAL_MS = 1_000;

export interface ParsedContentRange {
    end: number | null;
    start: number | null;
    total: number | null;
}

export type DownloadResponseDecision =
    | {
        action: 'append' | 'restart';
        offset: number;
        totalBytes: number | null;
    }
    | {
        action: 'complete';
        offset: number;
        totalBytes: number;
    }
    | {
        action: 'reject' | 'retry';
        offset: number;
        totalBytes: number | null;
    };

export class DownloadCoreError extends Error {
    public constructor(
        public readonly code: DownloadErrorCode,
        message: string,
        public readonly status?: number
    ) {
        super(message);
        this.name = 'DownloadCoreError';
    }
}

export function assertDownloadId(id: string): string {
    if (!DOWNLOAD_ID_PATTERN.test(id)) {
        throw new DownloadCoreError('storage', 'Invalid download identifier.');
    }
    return id.toLowerCase();
}

export function downloadFileName(id: string): string {
    return `${assertDownloadId(id)}.media`;
}

export function getOfflineMediaUrl(id: string): string {
    return `offline-media/${encodeURIComponent(assertDownloadId(id))}`;
}

export function normalizeDownloadSourceUrl(
    sourceUrl: string,
    baseUrl = globalThis.location?.href ?? 'http://localhost/'
): string {
    const value = sourceUrl.trim();
    if (!value) {
        throw new DownloadCoreError('http', 'A media source URL is required.');
    }

    const base = new URL(baseUrl);
    const url = new URL(value, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new DownloadCoreError('http', 'The media source must use HTTP or HTTPS.');
    }
    if (url.origin !== base.origin) {
        throw new DownloadCoreError(
            'authentication',
            'Authenticated downloads must use the Jellyfin server origin.'
        );
    }
    if (url.username || url.password) {
        throw new DownloadCoreError(
            'authentication',
            'Credentials must not be embedded in the media URL.'
        );
    }
    for (const key of url.searchParams.keys()) {
        if (AUTH_QUERY_PARAMETERS.has(key.toLowerCase())) {
            throw new DownloadCoreError(
                'authentication',
                'Authentication tokens must be sent in request headers, not in the media URL.'
            );
        }
    }
    return url.toString();
}

export function buildDownloadRequestHeaders(
    authHeaders: HeadersInit,
    offset = 0,
    validator?: string | null
): Headers {
    const headers = new Headers(authHeaders);
    const authenticated = Boolean(
        headers.get('Authorization')?.trim()
        || headers.get('X-Emby-Token')?.trim()
    );
    if (!authenticated) {
        throw new DownloadCoreError(
            'authentication',
            'An Authorization or X-Emby-Token header is required.'
        );
    }

    headers.delete('Range');
    headers.delete('If-Range');
    if (offset > 0) {
        headers.set('Range', `bytes=${offset}-`);
        if (validator) headers.set('If-Range', validator);
    }
    return headers;
}

export function parseContentLength(value: string | null): number | null {
    if (value === null || !/^\d+$/.test(value.trim())) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function normalizeOptionalInteger(
    value: number | null | undefined,
    label: string
): number | null {
    if (value === null || value === undefined) return null;
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new DownloadCoreError('http', `${label} must be a non-negative integer.`);
    }
    return value;
}

export function parseContentRange(value: string | null): ParsedContentRange | null {
    if (!value) return null;
    const trimmed = value.trim();
    const complete = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(trimmed);
    if (complete) {
        const start = Number(complete[1]);
        const end = Number(complete[2]);
        const total = complete[3] === '*' ? null : Number(complete[3]);
        if (
            !Number.isSafeInteger(start)
            || !Number.isSafeInteger(end)
            || start < 0
            || end < start
            || (total !== null && (!Number.isSafeInteger(total) || total <= end))
        ) {
            return null;
        }
        return { end, start, total };
    }

    const unsatisfied = /^bytes\s+\*\/(\d+)$/i.exec(trimmed);
    if (!unsatisfied) return null;
    const total = Number(unsatisfied[1]);
    if (!Number.isSafeInteger(total) || total < 0) return null;
    return { end: null, start: null, total };
}

export function decideDownloadResponse(
    status: number,
    headers: Headers,
    requestedOffset: number,
    knownTotal: number | null
): DownloadResponseDecision {
    const contentRange = parseContentRange(headers.get('Content-Range'));
    const contentLength = parseContentLength(headers.get('Content-Length'));

    if (status === 416) {
        if (
            requestedOffset > 0
            && contentRange?.total !== null
            && contentRange?.total === requestedOffset
        ) {
            return {
                action: 'complete',
                offset: requestedOffset,
                totalBytes: requestedOffset
            };
        }
        return {
            action: 'retry',
            offset: 0,
            totalBytes: contentRange?.total ?? knownTotal
        };
    }

    if (status === 206) {
        if (!contentRange || contentRange.start !== requestedOffset) {
            return {
                action: 'retry',
                offset: 0,
                totalBytes: contentRange?.total ?? knownTotal
            };
        }
        return {
            action: requestedOffset > 0 ? 'append' : 'restart',
            offset: requestedOffset,
            totalBytes: contentRange.total ?? knownTotal
        };
    }

    if (status >= 200 && status < 300) {
        return {
            action: 'restart',
            offset: 0,
            totalBytes: contentLength ?? knownTotal
        };
    }

    return {
        action: 'reject',
        offset: requestedOffset,
        totalBytes: knownTotal
    };
}

export function contentType(headers: Headers, fallback: string | null): string | null {
    const value = headers.get('Content-Type')?.split(';', 1)[0]?.trim();
    return value || fallback;
}

export function shouldPersistProgress(
    now: number,
    lastWriteAt: number,
    intervalMs = PROGRESS_WRITE_INTERVAL_MS
): boolean {
    return now - lastWriteAt >= intervalMs;
}

export function matchesDownloadScope(
    record: Pick<DownloadRecord, 'profileId' | 'userId'>,
    scope?: DownloadScope
): boolean {
    if (!scope) return true;
    return record.userId === scope.userId
        && (scope.profileId === undefined || record.profileId === scope.profileId);
}

export function matchesDownloadItem(
    record: Pick<DownloadRecord, 'itemId' | 'profileId' | 'userId'>,
    scope: DownloadProfileScope,
    itemId: string
): boolean {
    return matchesDownloadScope(record, scope) && record.itemId === itemId;
}

export function isDownloadRecord(value: unknown): value is DownloadRecord {
    if (!value || typeof value !== 'object') return false;
    const record = value as Partial<DownloadRecord>;
    return typeof record.id === 'string'
        && DOWNLOAD_ID_PATTERN.test(record.id)
        && record.id === record.id.toLowerCase()
        && typeof record.userId === 'string'
        && typeof record.profileId === 'string'
        && typeof record.itemId === 'string'
        && typeof record.name === 'string'
        && record.name.trim().length > 0
        && typeof record.sourceUrl === 'string'
        && typeof record.status === 'string'
        && DOWNLOAD_STATUSES.has(record.status as DownloadStatus)
        && typeof record.bytesDownloaded === 'number'
        && Number.isSafeInteger(record.bytesDownloaded)
        && record.bytesDownloaded >= 0
        && (record.totalBytes === null
            || (typeof record.totalBytes === 'number'
                && Number.isSafeInteger(record.totalBytes)
                && record.totalBytes >= 0))
        && (record.mimeType === null || typeof record.mimeType === 'string')
        && (record.error === null || typeof record.error === 'string')
        && (record.errorCode === null
            || (typeof record.errorCode === 'string'
                && DOWNLOAD_ERROR_CODES.has(record.errorCode as DownloadErrorCode)))
        && (record.etag === null || typeof record.etag === 'string')
        && (record.lastModified === null || typeof record.lastModified === 'string')
        && (record.itemType === undefined
            || record.itemType === null
            || typeof record.itemType === 'string')
        && (record.seriesName === undefined
            || record.seriesName === null
            || typeof record.seriesName === 'string')
        && isOptionalNullableInteger(record.productionYear)
        && isOptionalNullableInteger(record.parentIndexNumber)
        && isOptionalNullableInteger(record.indexNumber)
        && isOptionalNullableInteger(record.runtimeTicks)
        && typeof record.createdAt === 'number'
        && typeof record.updatedAt === 'number'
        && (record.completedAt === null || typeof record.completedAt === 'number');
}

function isOptionalNullableInteger(value: unknown): boolean {
    return value === undefined
        || value === null
        || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

export function classifyDownloadError(cause: unknown): {
    code: DownloadErrorCode;
    message: string;
} {
    if (cause instanceof DownloadCoreError) {
        return { code: cause.code, message: cause.message };
    }
    if (cause instanceof DOMException) {
        if (cause.name === 'AbortError') {
            return { code: 'aborted', message: 'The download was paused.' };
        }
        if (cause.name === 'QuotaExceededError') {
            return { code: 'quota', message: 'There is not enough storage space.' };
        }
        return { code: 'storage', message: cause.message || 'Browser storage failed.' };
    }
    if (cause instanceof TypeError) {
        return { code: 'network', message: cause.message || 'The network request failed.' };
    }
    if (cause instanceof Error) {
        return { code: 'unknown', message: cause.message };
    }
    return { code: 'unknown', message: 'The download failed.' };
}
