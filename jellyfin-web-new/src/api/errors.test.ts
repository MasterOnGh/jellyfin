import { describe, expect, it } from 'vitest';

import {
    ApiError,
    isOfflineFallbackError,
    parseRetryAfter,
    toApiError
} from './errors';

describe('API errors', () => {
    it('preserves status, problem detail and Retry-After', () => {
        const error = toApiError({
            response: {
                data: { detail: 'Try later' },
                headers: { 'retry-after': '12' },
                status: 429
            }
        });

        expect(error).toEqual(expect.objectContaining({
            code: 'rate_limited',
            detail: 'Try later',
            retryAfterSeconds: 12,
            status: 429
        }));
    });

    it('supports an HTTP-date Retry-After value', () => {
        expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:05 GMT', Date.UTC(2026, 0, 1))).toBe(5);
    });

    it('distinguishes network failures', () => {
        const error = toApiError(new TypeError('offline'));
        expect(error).toEqual(expect.objectContaining({
            code: 'network'
        } satisfies Partial<ApiError>));
        expect(isOfflineFallbackError(error)).toBe(true);
        expect(isOfflineFallbackError(new ApiError('unavailable', 503))).toBe(true);
        expect(isOfflineFallbackError(new ApiError('unknown', 502))).toBe(true);
        expect(isOfflineFallbackError(new ApiError('unauthorized', 401))).toBe(false);
    });
});
