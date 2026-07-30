import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DownloadCoreError } from './helpers';
import {
    deleteDownloadRecord,
    getDownloadRecord,
    listDownloadRecords,
    putDownloadRecord
} from './metadata';
import { DownloadManager } from './manager';
import {
    deleteDownloadFile,
    getDownloadFileHandle,
    getDownloadFileSize
} from './opfs';
import {
    ensureDownloadCapacity,
    requestPersistentDownloadStorage
} from './storage';
import type { DownloadRecord, StartDownloadInput } from './types';

vi.mock('./metadata', () => ({
    deleteDownloadRecord: vi.fn(),
    getDownloadRecord: vi.fn(),
    listDownloadRecords: vi.fn(),
    putDownloadRecord: vi.fn()
}));

vi.mock('./opfs', () => ({
    deleteDownloadFile: vi.fn(),
    getDownloadFileHandle: vi.fn(),
    getDownloadFileSize: vi.fn(),
    readDownloadFile: vi.fn()
}));

vi.mock('./storage', () => ({
    ensureDownloadCapacity: vi.fn(),
    getDownloadStorageStatus: vi.fn(),
    requestPersistentDownloadStorage: vi.fn()
}));

const id = '123e4567-e89b-12d3-a456-426614174000';
const authHeaders = { Authorization: 'MediaBrowser Token="secret"' };
const record: DownloadRecord = {
    bytesDownloaded: 0,
    completedAt: null,
    createdAt: 1,
    error: null,
    errorCode: null,
    etag: null,
    id,
    itemId: 'item-1',
    lastModified: null,
    mimeType: 'video/mp4',
    name: 'Film',
    profileId: 'profile-1',
    sourceUrl: `${location.origin}/Videos/item-1/stream`,
    status: 'paused',
    totalBytes: 4,
    updatedAt: 1,
    userId: 'user-1'
};
const input: StartDownloadInput = {
    authHeaders,
    itemId: record.itemId,
    mimeType: 'video/mp4',
    name: record.name,
    profileId: record.profileId,
    sourceUrl: record.sourceUrl,
    totalBytes: 4,
    userId: record.userId
};

const mockedDeleteRecord = vi.mocked(deleteDownloadRecord);
const mockedGetRecord = vi.mocked(getDownloadRecord);
const mockedListRecords = vi.mocked(listDownloadRecords);
const mockedPutRecord = vi.mocked(putDownloadRecord);
const mockedDeleteFile = vi.mocked(deleteDownloadFile);
const mockedGetFileHandle = vi.mocked(getDownloadFileHandle);
const mockedGetFileSize = vi.mocked(getDownloadFileSize);
const mockedEnsureCapacity = vi.mocked(ensureDownloadCapacity);
const mockedPersistStorage = vi.mocked(requestPersistentDownloadStorage);
const locksDescriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');

function grantingLocks(): LockManager {
    return {
        request: vi.fn(async (
            name: string,
            _options: LockOptions,
            callback: LockGrantedCallback<unknown>
        ) => callback({ name, mode: 'exclusive' } as Lock))
    } as unknown as LockManager;
}

function setLocks(value: LockManager | undefined): void {
    Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value
    });
}

async function waitForFailedRecord(): Promise<DownloadRecord> {
    await vi.waitFor(() => {
        expect(mockedPutRecord).toHaveBeenCalledWith(expect.objectContaining({
            status: 'failed'
        }));
    });
    return mockedPutRecord.mock.calls
        .map(([ value ]) => value)
        .findLast(value => value.status === 'failed')!;
}

async function waitForCompletedRecord(): Promise<DownloadRecord> {
    await vi.waitFor(() => {
        expect(mockedPutRecord).toHaveBeenCalledWith(expect.objectContaining({
            status: 'completed'
        }));
    });
    return mockedPutRecord.mock.calls
        .map(([ value ]) => value)
        .findLast(value => value.status === 'completed')!;
}

beforeEach(() => {
    vi.clearAllMocks();
    setLocks(grantingLocks());
    mockedDeleteFile.mockResolvedValue();
    mockedDeleteRecord.mockResolvedValue();
    mockedGetFileSize.mockResolvedValue(0);
    mockedPersistStorage.mockResolvedValue(false);
    mockedPutRecord.mockResolvedValue();
    mockedEnsureCapacity.mockResolvedValue();
});

afterEach(() => {
    if (locksDescriptor) {
        Object.defineProperty(navigator, 'locks', locksDescriptor);
    } else {
        Reflect.deleteProperty(navigator, 'locks');
    }
});

describe('DownloadManager safety', () => {
    it('revalidates a persisted source URL before resuming', async () => {
        mockedGetRecord.mockResolvedValue({
            ...record,
            sourceUrl: 'https://other.test/Videos/item-1/stream'
        });
        const fetcher = vi.fn<typeof fetch>();
        const manager = new DownloadManager({ fetch: fetcher });

        await expect(manager.resume(id, { authHeaders })).rejects.toThrow(/server origin/);
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('recovers an interrupted status when Web Locks are unavailable', async () => {
        setLocks(undefined);
        mockedListRecords.mockResolvedValue([ {
            ...record,
            bytesDownloaded: 2,
            status: 'downloading'
        } ]);
        mockedGetFileSize.mockResolvedValue(3);

        const [ recovered ] = await new DownloadManager().list();

        expect(recovered).toMatchObject({
            bytesDownloaded: 3,
            error: null,
            errorCode: null,
            status: 'paused'
        });
        expect(mockedPutRecord).toHaveBeenCalledWith(recovered);
    });

    it('does not start a second transfer while another tab holds the lock', async () => {
        const request = vi.fn(async (
                _name: string,
                _options: LockOptions,
                callback: LockGrantedCallback<unknown>
            ) => callback(null));
        setLocks({ request } as unknown as LockManager);
        mockedGetRecord.mockResolvedValue({
            ...record,
            status: 'downloading'
        });
        const fetcher = vi.fn<typeof fetch>();
        const manager = new DownloadManager({ fetch: fetcher });

        await manager.resume(id, { authHeaders });
        await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
        expect(fetcher).not.toHaveBeenCalled();
        expect(mockedPutRecord).not.toHaveBeenCalledWith(expect.objectContaining({
            status: 'failed'
        }));
    });

    it('does not delete a file while another tab holds its transfer lock', async () => {
        setLocks({
            request: vi.fn(async (
                _name: string,
                _options: LockOptions,
                callback: LockGrantedCallback<unknown>
            ) => callback(null))
        } as unknown as LockManager);

        await expect(new DownloadManager().delete(id)).rejects.toThrow(/another tab/);
        expect(mockedDeleteRecord).not.toHaveBeenCalled();
        expect(mockedDeleteFile).not.toHaveBeenCalled();
    });

    it('fails safely instead of writing without cross-tab locking', async () => {
        setLocks(undefined);
        const fetcher = vi.fn<typeof fetch>();
        const manager = new DownloadManager({
            createId: () => id,
            fetch: fetcher
        });

        await manager.start(input);
        const failed = await waitForFailedRecord();

        expect(fetcher).not.toHaveBeenCalled();
        expect(failed.errorCode).toBe('unsupported');
    });

    it('cancels the HTTP body when the quota check fails', async () => {
        const response = new Response(new Uint8Array([ 1, 2, 3, 4 ]), {
            headers: { 'Content-Length': '4' }
        });
        const cancel = vi.spyOn(response.body!, 'cancel');
        mockedEnsureCapacity.mockRejectedValue(
            new DownloadCoreError('quota', 'No space.')
        );
        const manager = new DownloadManager({
            createId: () => id,
            fetch: vi.fn(async () => response)
        });

        await manager.start(input);
        const failed = await waitForFailedRecord();

        expect(cancel).toHaveBeenCalled();
        expect(failed).toMatchObject({
            error: 'No space.',
            errorCode: 'quota'
        });
    });

    it('restarts from zero when a partial file has no server validator', async () => {
        mockedGetRecord.mockResolvedValue({
            ...record,
            bytesDownloaded: 2,
            etag: null,
            lastModified: null,
            status: 'paused'
        });
        mockedGetFileSize.mockResolvedValue(2);
        const createWritable = vi.fn(async () => ({
            close: vi.fn(),
            seek: vi.fn(),
            write: vi.fn()
        }));
        mockedGetFileHandle.mockResolvedValue({
            createWritable
        } as unknown as FileSystemFileHandle);
        const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            expect(new Headers(init?.headers).has('Range')).toBe(false);
            return new Response(new Uint8Array([ 1, 2, 3, 4 ]), {
                headers: { 'Content-Length': '4' }
            });
        });
        const manager = new DownloadManager({ fetch: fetcher });

        await manager.resume(id, { authHeaders });
        const completed = await waitForCompletedRecord();

        expect(createWritable).toHaveBeenCalledWith({ keepExistingData: false });
        expect(completed.bytesDownloaded).toBe(4);
    });

    it('keeps the write error when closing the OPFS stream also fails', async () => {
        const response = new Response(new Uint8Array([ 1, 2, 3, 4 ]), {
            headers: { 'Content-Length': '4' }
        });
        mockedGetFileHandle.mockResolvedValue({
            createWritable: vi.fn(async () => ({
                close: vi.fn(async () => {
                    throw new Error('close failed');
                }),
                seek: vi.fn(),
                write: vi.fn(async () => {
                    throw new DownloadCoreError('storage', 'write failed');
                })
            }))
        } as unknown as FileSystemFileHandle);
        const manager = new DownloadManager({
            createId: () => id,
            fetch: vi.fn(async () => response)
        });

        await manager.start(input);
        const failed = await waitForFailedRecord();

        expect(failed).toMatchObject({
            error: 'write failed',
            errorCode: 'storage'
        });
    });

    it('restores metadata when deleting the OPFS file fails', async () => {
        mockedGetRecord.mockResolvedValue(record);
        const opfsError = new DOMException('busy', 'InvalidStateError');
        mockedDeleteFile.mockRejectedValue(opfsError);

        await expect(new DownloadManager().delete(id)).rejects.toBe(opfsError);
        expect(mockedDeleteRecord).toHaveBeenCalledWith(id);
        expect(mockedPutRecord).toHaveBeenCalledWith(record);
    });
});
