import { describe, expect, it } from 'vitest';

import {
    resolveByteRange,
    resolveOfflineVideoMimeType
} from './offlineRange';

describe('resolveOfflineVideoMimeType', () => {
    it.each([
        [ 'video/mp4', 'video/mp4' ],
        [ 'VIDEO/MP2T', 'video/mp2t' ],
        [ 'video/quicktime', 'video/quicktime' ],
        [ 'video/webm', 'video/webm' ],
        [ 'video/x-matroska', 'video/x-matroska' ]
    ])('accepts and normalizes %s', (value, expected) => {
        expect(resolveOfflineVideoMimeType(value)).toBe(expected);
    });

    it.each([
        null,
        '',
        ' video/mp4',
        'video/mp4 ',
        'video/mp4; codecs=avc1',
        'video/mp4\r\nX-Test: injected',
        'text/html',
        'video/avi',
        'video/mp4/octet-stream'
    ])('rejects an unsafe or unsupported media type: %s', value => {
        expect(resolveOfflineVideoMimeType(value)).toBeNull();
    });
});

describe('resolveByteRange', () => {
    it('returns the full representation when Range is absent', () => {
        expect(resolveByteRange(null, 100)).toEqual({ kind: 'full' });
        expect(resolveByteRange(null, 0)).toEqual({ kind: 'full' });
    });

    it.each([
        [ 'bytes=10-19', 100, 10, 19, 10 ],
        [ 'bytes=90-', 100, 90, 99, 10 ],
        [ 'bytes=90-200', 100, 90, 99, 10 ],
        [ 'bytes=-20', 100, 80, 99, 20 ],
        [ 'bytes=-200', 100, 0, 99, 100 ]
    ])('resolves %s', (header, size, start, end, length) => {
        expect(resolveByteRange(header, size)).toEqual({
            kind: 'partial',
            range: { end, length, start }
        });
    });

    it.each([
        'bytes=',
        'bytes=-0',
        'bytes=20-10',
        'bytes=100-',
        'bytes=0-1,4-5',
        'items=0-1',
        'bytes=9007199254740992-'
    ])('rejects an invalid or unsatisfiable range: %s', header => {
        expect(resolveByteRange(header, 100)).toEqual({ kind: 'unsatisfiable' });
    });

    it('rejects every range for an empty file', () => {
        expect(resolveByteRange('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' });
        expect(resolveByteRange('bytes=-1', 0)).toEqual({ kind: 'unsatisfiable' });
    });

    it('rejects an invalid file size', () => {
        expect(() => resolveByteRange(null, -1)).toThrow(RangeError);
        expect(() => resolveByteRange(null, Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    });
});
