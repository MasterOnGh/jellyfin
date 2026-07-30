export type DownloadStatus =
    | 'completed'
    | 'downloading'
    | 'failed'
    | 'paused';

export type DownloadErrorCode =
    | 'aborted'
    | 'authentication'
    | 'http'
    | 'incomplete'
    | 'network'
    | 'not_found'
    | 'quota'
    | 'storage'
    | 'unsupported'
    | 'unknown';

export interface DownloadRecord {
    bytesDownloaded: number;
    completedAt: number | null;
    createdAt: number;
    error: string | null;
    errorCode: DownloadErrorCode | null;
    etag: string | null;
    id: string;
    indexNumber?: number | null;
    itemId: string;
    itemType?: string | null;
    lastModified: string | null;
    mimeType: string | null;
    name: string;
    parentIndexNumber?: number | null;
    profileId: string;
    productionYear?: number | null;
    runtimeTicks?: number | null;
    seriesName?: string | null;
    sourceUrl: string;
    status: DownloadStatus;
    totalBytes: number | null;
    updatedAt: number;
    userId: string;
}

export interface DownloadProfileScope {
    profileId: string;
    userId: string;
}

export interface DownloadScope {
    profileId?: string;
    userId: string;
}

export interface StartDownloadInput extends DownloadProfileScope {
    authHeaders: HeadersInit;
    indexNumber?: number | null;
    itemId: string;
    itemType?: string | null;
    mimeType?: string;
    name: string;
    parentIndexNumber?: number | null;
    productionYear?: number | null;
    runtimeTicks?: number | null;
    seriesName?: string | null;
    sourceUrl: string;
    totalBytes?: number;
}

export interface ResumeDownloadInput {
    authHeaders: HeadersInit;
}

export interface DownloadStorageStatus {
    availableBytes: number | null;
    opfsSupported: boolean;
    persisted: boolean;
    quotaBytes: number | null;
    usageBytes: number | null;
}

export type DownloadListener = () => void;
