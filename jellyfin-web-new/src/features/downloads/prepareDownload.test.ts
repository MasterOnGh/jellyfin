import { describe, expect, it, vi } from 'vitest';

import type {
    PlaybackHttpClient,
    PlaybackInfoResponse,
    PlaybackPreferences
} from '../../player';
import {
    OfflineMediaUnsupportedError,
    prepareDownload
} from './prepareDownload';

const preferences: PlaybackPreferences = {
    AllowAudioTranscoding: true,
    AllowContainerRemuxing: true,
    AllowVideoTranscoding: true,
    AudioDescriptionEnabled: false,
    ClosedCaptionsEnabled: false,
    PreferDirectPlay: true,
    PreferHardwareTranscoding: true,
    SkipCreditsEnabled: false,
    SubtitlesEnabled: true
};

function client(response: PlaybackInfoResponse): PlaybackHttpClient {
    return {
        authHeaders: () => ({ 'X-Emby-Token': 'secret' }),
        mediaUrl: path => `https://media.example/${path}`,
        request: vi.fn().mockResolvedValue(response),
        url: (path, query = {}) => {
            const url = new URL(path, 'https://media.example/');
            Object.entries(query).forEach(([ key, value ]) => {
                if (value !== null && value !== undefined) {
                    url.searchParams.set(key, String(value));
                }
            });
            return url.toString();
        }
    };
}

describe('prepareDownload', () => {
    it('prepares an authenticated direct-play file without putting the token in its URL', async () => {
        const playbackClient = client({
            MediaSources: [{
                Container: 'mp4',
                Id: 'source-1',
                SupportsDirectPlay: true
            }],
            PlaySessionId: 'play-1'
        });

        const result = await prepareDownload(
            playbackClient,
            { Id: 'movie-1', Type: 'Movie' },
            'user-1',
            preferences
        );

        expect(result).toMatchObject({
            headers: { 'X-Emby-Token': 'secret' },
            mediaSourceId: 'source-1',
            mimeType: 'video/mp4'
        });
        expect(result.url).toContain('/Videos/movie-1/stream.mp4');
        expect(result.url).not.toContain('secret');
        expect(playbackClient.request).toHaveBeenCalledWith(
            'Items/movie-1/PlaybackInfo',
            expect.objectContaining({ method: 'POST' })
        );
    });

    it('rejects sources that require transcoding or use an unsupported container', async () => {
        await expect(prepareDownload(client({
            MediaSources: [{
                Container: 'mp4',
                Id: 'source-1',
                SupportsDirectPlay: false,
                SupportsTranscoding: true,
                TranscodingUrl: '/Videos/movie-1/master.m3u8?TranscodeReasons=VideoCodecNotSupported'
            }]
        }), { Id: 'movie-1' }, 'user-1', preferences))
            .rejects.toBeInstanceOf(OfflineMediaUnsupportedError);

        await expect(prepareDownload(client({
            MediaSources: [{
                Container: 'avi',
                Id: 'source-2',
                SupportsDirectPlay: true
            }]
        }), { Id: 'movie-2' }, 'user-1', preferences))
            .rejects.toBeInstanceOf(OfflineMediaUnsupportedError);
    });
});
