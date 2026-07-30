import { describe, expect, it } from 'vitest';

import {
    buildDownloadRequestHeaders,
    decideDownloadResponse,
    DownloadCoreError,
    getOfflineMediaUrl,
    isDownloadRecord,
    matchesDownloadScope,
    normalizeDownloadSourceUrl,
    normalizeOptionalInteger,
    parseContentRange,
    shouldPersistProgress
} from './helpers';
import type { DownloadRecord } from './types';

const record: DownloadRecord = {
    bytesDownloaded: 0,
    completedAt: null,
    createdAt: 1,
    error: null,
    errorCode: null,
    etag: null,
    id: '123e4567-e89b-12d3-a456-426614174000',
    indexNumber: 3,
    itemId: 'item-1',
    itemType: 'Episode',
    lastModified: null,
    mimeType: 'video/mp4',
    name: 'The episode',
    parentIndexNumber: 1,
    profileId: 'profile-1',
    productionYear: 2026,
    runtimeTicks: 25_000_000_000,
    seriesName: 'The series',
    sourceUrl: 'https://media.test/Videos/item-1/stream',
    status: 'paused',
    totalBytes: 1_000,
    updatedAt: 1,
    userId: 'user-1'
};

describe('download helpers', () => {
    it('parses complete and unsatisfied Content-Range headers', () => {
        expect(parseContentRange('bytes 100-199/1000')).toEqual({
            end: 199,
            start: 100,
            total: 1_000
        });
        expect(parseContentRange('bytes */1000')).toEqual({
            end: null,
            start: null,
            total: 1_000
        });
        expect(parseContentRange('bytes 200-100/1000')).toBeNull();
    });

    it('appends a valid partial response', () => {
        const headers = new Headers({
            'Content-Length': '900',
            'Content-Range': 'bytes 100-999/1000'
        });
        expect(decideDownloadResponse(206, headers, 100, null)).toEqual({
            action: 'append',
            offset: 100,
            totalBytes: 1_000
        });
    });

    it('does not invent a total for a partial response with an unknown size', () => {
        expect(decideDownloadResponse(
            206,
            new Headers({
                'Content-Length': '100',
                'Content-Range': 'bytes 100-199/*'
            }),
            100,
            null
        )).toEqual({
            action: 'append',
            offset: 100,
            totalBytes: null
        });
    });

    it('restarts when a server ignores Range and retries mismatched ranges', () => {
        expect(decideDownloadResponse(
            200,
            new Headers({ 'Content-Length': '1000' }),
            100,
            null
        )).toEqual({
            action: 'restart',
            offset: 0,
            totalBytes: 1_000
        });
        expect(decideDownloadResponse(
            206,
            new Headers({ 'Content-Range': 'bytes 0-999/1000' }),
            100,
            null
        )).toEqual({
            action: 'retry',
            offset: 0,
            totalBytes: 1_000
        });
    });

    it('recognizes an already complete file after HTTP 416', () => {
        expect(decideDownloadResponse(
            416,
            new Headers({ 'Content-Range': 'bytes */1000' }),
            1_000,
            null
        )).toEqual({
            action: 'complete',
            offset: 1_000,
            totalBytes: 1_000
        });
    });

    it('adds Range without persisting authentication in URLs', () => {
        const headers = buildDownloadRequestHeaders(
            { Authorization: 'MediaBrowser Token="secret"' },
            250,
            '"etag"'
        );
        expect(headers.get('Range')).toBe('bytes=250-');
        expect(headers.get('If-Range')).toBe('"etag"');
        expect(normalizeDownloadSourceUrl(
            '/Videos/item/stream?MediaSourceId=source',
            'https://media.test/web/'
        )).toBe('https://media.test/Videos/item/stream?MediaSourceId=source');
        expect(() => normalizeDownloadSourceUrl(
            '/Videos/item/stream?api_key=secret',
            'https://media.test/web/'
        )).toThrow(DownloadCoreError);
        expect(() => normalizeDownloadSourceUrl(
            'https://other.test/Videos/item/stream',
            'https://media.test/web/'
        )).toThrow(/server origin/);
    });

    it('requires an authenticated fetch', () => {
        expect(() => buildDownloadRequestHeaders({ Accept: 'video/*' }))
            .toThrow(/Authorization/);
    });

    it('builds a relative offline URL and applies profile scopes', () => {
        expect(getOfflineMediaUrl(record.id)).toBe(`offline-media/${record.id}`);
        expect(matchesDownloadScope(record, { userId: 'user-1' })).toBe(true);
        expect(matchesDownloadScope(record, {
            profileId: 'profile-2',
            userId: 'user-1'
        })).toBe(false);
    });

    it('throttles metadata progress writes', () => {
        expect(shouldPersistProgress(1_999, 1_000)).toBe(false);
        expect(shouldPersistProgress(2_000, 1_000)).toBe(true);
    });

    it('validates durable numeric metadata', () => {
        expect(normalizeOptionalInteger(undefined, 'runtimeTicks')).toBeNull();
        expect(normalizeOptionalInteger(25_000_000_000, 'runtimeTicks'))
            .toBe(25_000_000_000);
        expect(() => normalizeOptionalInteger(-1, 'runtimeTicks'))
            .toThrow(/non-negative integer/);
    });

    it('validates persisted records', () => {
        const roundTrip: unknown = JSON.parse(JSON.stringify(record));
        expect(isDownloadRecord(roundTrip)).toBe(true);
        expect(roundTrip).toEqual(record);
        expect(isDownloadRecord({ ...record, bytesDownloaded: -1 })).toBe(false);
        expect(isDownloadRecord({ ...record, runtimeTicks: -1 })).toBe(false);
        expect(isDownloadRecord({ ...record, seriesName: 42 })).toBe(false);
        expect(isDownloadRecord({ ...record, id: record.id.toUpperCase() })).toBe(false);
        expect(isDownloadRecord({ ...record, status: 'queued' })).toBe(false);
    });
});
