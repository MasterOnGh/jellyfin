import {
    buildPlaybackRequest,
    selectPlaybackSource
} from '../../player';
import type {
    PlaybackHttpClient,
    PlaybackInfoResponse,
    PlaybackPreferences,
    PlayerItem
} from '../../player';

export class OfflineMediaUnsupportedError extends Error {
    public constructor() {
        super('No directly playable offline source is available.');
        this.name = 'OfflineMediaUnsupportedError';
    }
}

export interface PreparedDownload {
    headers: HeadersInit;
    mediaSourceId?: string | undefined;
    mimeType: string;
    url: string;
}

const mimeTypes: Record<string, string> = {
    m4v: 'video/mp4',
    mkv: 'video/x-matroska',
    mov: 'video/quicktime',
    mp4: 'video/mp4',
    ts: 'video/mp2t',
    webm: 'video/webm'
};

function sourceMimeType(container?: string | null) {
    const value = container?.split(',')[0]?.trim().toLowerCase() ?? '';
    return mimeTypes[value] ?? null;
}

export async function prepareDownload(
    client: PlaybackHttpClient,
    item: PlayerItem,
    userId: string,
    preferences: PlaybackPreferences,
    signal?: AbortSignal
): Promise<PreparedDownload> {
    const directOnly: PlaybackPreferences = {
        ...preferences,
        AllowAudioTranscoding: false,
        AllowContainerRemuxing: false,
        AllowVideoTranscoding: false,
        PreferDirectPlay: true,
        PreferredSubtitleLanguage: null,
        SubtitlesEnabled: false
    };
    const request = buildPlaybackRequest(userId, directOnly, 0);
    const response = await client.request<PlaybackInfoResponse>(
        `Items/${encodeURIComponent(item.Id)}/PlaybackInfo`,
        {
            body: JSON.stringify(request),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
            ...(signal ? { signal } : {})
        }
    );
    let selection;
    try {
        selection = selectPlaybackSource(
            response,
            item.Id,
            directOnly,
            client.url.bind(client)
        );
    } catch {
        throw new OfflineMediaUnsupportedError();
    }
    const mimeType = sourceMimeType(selection.source.Container);
    if (selection.method !== 'DirectPlay' || selection.isHls || !mimeType) {
        throw new OfflineMediaUnsupportedError();
    }

    return {
        headers: client.authHeaders(),
        ...(selection.source.Id ? { mediaSourceId: selection.source.Id } : {}),
        mimeType,
        url: selection.url
    };
}
