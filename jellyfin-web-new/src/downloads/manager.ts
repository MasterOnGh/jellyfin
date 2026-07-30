import {
    assertDownloadId,
    buildDownloadRequestHeaders,
    classifyDownloadError,
    contentType,
    decideDownloadResponse,
    DownloadCoreError,
    getOfflineMediaUrl,
    matchesDownloadItem,
    normalizeDownloadSourceUrl,
    normalizeOptionalInteger,
    parseContentLength,
    PROGRESS_WRITE_INTERVAL_MS,
    shouldPersistProgress
} from './helpers';
import {
    deleteDownloadRecord,
    getDownloadRecord,
    listDownloadRecords,
    putDownloadRecord
} from './metadata';
import {
    deleteDownloadFile,
    getDownloadFileHandle,
    getDownloadFileSize,
    readDownloadFile
} from './opfs';
import {
    ensureDownloadCapacity,
    getDownloadStorageStatus,
    requestPersistentDownloadStorage
} from './storage';
import type {
    DownloadListener,
    DownloadProfileScope,
    DownloadRecord,
    DownloadScope,
    DownloadStorageStatus,
    ResumeDownloadInput,
    StartDownloadInput
} from './types';

interface ActiveDownload {
    controller: AbortController;
    current: DownloadRecord;
    pauseRequested: boolean;
    promise: Promise<void>;
}

interface DownloadManagerOptions {
    createId?: () => string;
    fetch?: typeof fetch;
    now?: () => number;
    progressWriteIntervalMs?: number;
}

interface PreparedResponse {
    alreadyComplete: boolean;
    offset: number;
    response: Response;
    totalBytes: number | null;
}

export class DownloadManager {
    private readonly active = new Map<string, ActiveDownload>();
    private readonly createId: () => string;
    private readonly fetcher: typeof fetch;
    private readonly listeners = new Set<DownloadListener>();
    private readonly now: () => number;
    private readonly progressWriteIntervalMs: number;

    public constructor(options: DownloadManagerOptions = {}) {
        this.createId = options.createId ?? (() => crypto.randomUUID());
        this.fetcher = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
        this.now = options.now ?? Date.now;
        this.progressWriteIntervalMs =
            options.progressWriteIntervalMs ?? PROGRESS_WRITE_INTERVAL_MS;
    }

    public subscribe = (listener: DownloadListener): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    public async list(scope?: DownloadScope): Promise<DownloadRecord[]> {
        const records = await listDownloadRecords(scope);
        return Promise.all(records.map(record => this.recoverInterrupted(record)));
    }

    public async get(id: string): Promise<DownloadRecord | null> {
        const normalizedId = assertDownloadId(id);
        const running = this.active.get(normalizedId);
        if (running) return running.current;
        const record = await getDownloadRecord(normalizedId);
        return record ? this.recoverInterrupted(record) : null;
    }

    public async getCompletedForItem(
        scope: DownloadProfileScope,
        itemId: string
    ): Promise<DownloadRecord | null> {
        const matches = (await this.list(scope))
            .filter(record =>
                record.status === 'completed'
                && matchesDownloadItem(record, scope, itemId))
            .sort((left, right) =>
                (right.completedAt ?? right.updatedAt) - (left.completedAt ?? left.updatedAt));
        return matches[0] ?? null;
    }

    public async start(input: StartDownloadInput): Promise<DownloadRecord> {
        const authHeaders = buildDownloadRequestHeaders(input.authHeaders);
        const sourceUrl = normalizeDownloadSourceUrl(input.sourceUrl);
        const name = input.name.trim();
        if (!name) {
            throw new DownloadCoreError('http', 'A display name is required.');
        }
        const now = this.now();
        const id = assertDownloadId(this.createId());
        const record: DownloadRecord = {
            bytesDownloaded: 0,
            completedAt: null,
            createdAt: now,
            error: null,
            errorCode: null,
            etag: null,
            id,
            indexNumber: normalizeOptionalInteger(input.indexNumber, 'indexNumber'),
            itemId: input.itemId,
            itemType: input.itemType?.trim() || null,
            lastModified: null,
            mimeType: input.mimeType?.trim() || null,
            name,
            parentIndexNumber: normalizeOptionalInteger(
                input.parentIndexNumber,
                'parentIndexNumber'
            ),
            profileId: input.profileId,
            productionYear: normalizeOptionalInteger(input.productionYear, 'productionYear'),
            runtimeTicks: normalizeOptionalInteger(input.runtimeTicks, 'runtimeTicks'),
            seriesName: input.seriesName?.trim() || null,
            sourceUrl,
            status: 'downloading',
            totalBytes: normalizeOptionalInteger(input.totalBytes, 'totalBytes'),
            updatedAt: now,
            userId: input.userId
        };
        await putDownloadRecord(record);
        this.notify();
        this.launch(record, authHeaders);
        return record;
    }

    public async resume(id: string, input: ResumeDownloadInput): Promise<DownloadRecord> {
        const authHeaders = buildDownloadRequestHeaders(input.authHeaders);
        const normalizedId = assertDownloadId(id);
        const running = this.active.get(normalizedId);
        if (running) return running.current;

        const record = await getDownloadRecord(normalizedId);
        if (!record) {
            throw new DownloadCoreError('not_found', 'The download does not exist.');
        }
        if (record.status === 'completed') return record;

        const next: DownloadRecord = {
            ...record,
            error: null,
            errorCode: null,
            sourceUrl: normalizeDownloadSourceUrl(record.sourceUrl),
            status: 'downloading',
            updatedAt: this.now()
        };
        this.launch(next, authHeaders);
        return next;
    }

    public async pause(id: string): Promise<DownloadRecord | null> {
        const normalizedId = assertDownloadId(id);
        const running = this.active.get(normalizedId);
        if (running) {
            running.pauseRequested = true;
            running.controller.abort();
            await running.promise;
            return (await getDownloadRecord(normalizedId)) ?? running.current;
        }

        const record = await getDownloadRecord(normalizedId);
        if (!record || record.status !== 'downloading') return record;
        return this.withMutationLock(normalizedId, async () => {
            const current = await getDownloadRecord(normalizedId);
            if (!current || current.status !== 'downloading') return current;
            const paused: DownloadRecord = {
                ...current,
                error: null,
                errorCode: null,
                status: 'paused',
                updatedAt: this.now()
            };
            await putDownloadRecord(paused);
            this.notify();
            return paused;
        });
    }

    public async delete(id: string): Promise<boolean> {
        const normalizedId = assertDownloadId(id);
        if (this.active.has(normalizedId)) await this.pause(normalizedId);
        return this.withMutationLock(normalizedId, async () => {
            const record = await getDownloadRecord(normalizedId);
            if (!record) return false;
            await deleteDownloadRecord(normalizedId);
            try {
                await deleteDownloadFile(normalizedId);
            } catch (cause) {
                try {
                    await putDownloadRecord(record);
                } catch {
                    // Preserve the OPFS failure even if metadata rollback also fails.
                }
                this.notify();
                throw cause;
            }
            this.notify();
            return true;
        });
    }

    public async clear(scope: DownloadScope): Promise<number> {
        const records = await this.list(scope);
        await Promise.all(records.map(record => this.delete(record.id)));
        return records.length;
    }

    public localUrl(id: string): string {
        return getOfflineMediaUrl(id);
    }

    public readFile(id: string): Promise<File | null> {
        return readDownloadFile(id);
    }

    public storageStatus(): Promise<DownloadStorageStatus> {
        return getDownloadStorageStatus();
    }

    public requestPersistentStorage(): Promise<boolean> {
        return requestPersistentDownloadStorage();
    }

    private notify(): void {
        this.listeners.forEach(listener => {
            try {
                listener();
            } catch {
                // A UI subscriber must not be able to interrupt a transfer.
            }
        });
    }

    private launch(record: DownloadRecord, authHeaders: HeadersInit): void {
        const controller = new AbortController();
        const running: ActiveDownload = {
            controller,
            current: record,
            pauseRequested: false,
            promise: Promise.resolve()
        };
        this.active.set(record.id, running);
        running.promise = this.withDownloadLock(
            record.id,
            () => this.transfer(running, authHeaders)
        )
            .catch(async cause => {
                if (running.current.status === 'failed' || running.current.status === 'paused') {
                    await putDownloadRecord(running.current).catch(() => undefined);
                    this.notify();
                    return;
                }
                const failure = classifyDownloadError(cause);
                running.current = {
                    ...running.current,
                    error: failure.message,
                    errorCode: failure.code,
                    status: 'failed',
                    updatedAt: this.now()
                };
                await putDownloadRecord(running.current).catch(() => undefined);
                this.notify();
            })
            .finally(() => {
                if (this.active.get(record.id) === running) {
                    this.active.delete(record.id);
                }
            });
    }

    private async transfer(running: ActiveDownload, authHeaders: HeadersInit): Promise<void> {
        let response: Response | null = null;
        let writable: FileSystemWritableFileStream | null = null;
        let bytesDownloaded = running.current.bytesDownloaded;
        try {
            await requestPersistentDownloadStorage();
            const fileSize = await getDownloadFileSize(running.current.id);
            const resumeOffset = fileSize > 0
                && (running.current.etag || running.current.lastModified)
                ? fileSize
                : 0;
            bytesDownloaded = resumeOffset;
            running.current = {
                ...running.current,
                bytesDownloaded: resumeOffset,
                updatedAt: this.now()
            };
            await this.persist(running);

            const prepared = await this.prepareResponse(
                running.current,
                authHeaders,
                resumeOffset,
                running.controller.signal
            );
            response = prepared.response;
            if (prepared.alreadyComplete) {
                await prepared.response.body?.cancel().catch(() => undefined);
                const completedAt = this.now();
                running.current = {
                    ...running.current,
                    bytesDownloaded: prepared.offset,
                    completedAt,
                    error: null,
                    errorCode: null,
                    status: 'completed',
                    totalBytes: prepared.totalBytes,
                    updatedAt: completedAt
                };
                await this.persist(running);
                return;
            }

            const responseMimeType = contentType(
                prepared.response.headers,
                running.current.mimeType
            );
            const etag = prepared.response.headers.get('ETag') ?? running.current.etag;
            const lastModified =
                prepared.response.headers.get('Last-Modified') ?? running.current.lastModified;
            running.current = {
                ...running.current,
                bytesDownloaded: prepared.offset,
                etag,
                lastModified,
                mimeType: responseMimeType,
                totalBytes: prepared.totalBytes,
                updatedAt: this.now()
            };
            bytesDownloaded = prepared.offset;
            await this.persist(running);

            const contentLength = parseContentLength(
                prepared.response.headers.get('Content-Length')
            );
            const remainingBytes = prepared.totalBytes === null
                ? contentLength
                : Math.max(0, prepared.totalBytes - prepared.offset);
            await ensureDownloadCapacity(remainingBytes);

            if (!prepared.response.body) {
                throw new DownloadCoreError('network', 'The media response has no readable body.');
            }

            const handle = await getDownloadFileHandle(running.current.id);
            const append = prepared.offset > 0;
            writable = await handle.createWritable({ keepExistingData: append });
            if (append) await writable.seek(prepared.offset);

            const reader = prepared.response.body.getReader();
            let lastWriteAt = this.now();
            try {
                while (true) {
                    const result = await reader.read();
                    if (result.done) break;
                    await writable.write(result.value);
                    bytesDownloaded += result.value.byteLength;
                    running.current = {
                        ...running.current,
                        bytesDownloaded,
                        updatedAt: this.now()
                    };
                    if (shouldPersistProgress(
                        running.current.updatedAt,
                        lastWriteAt,
                        this.progressWriteIntervalMs
                    )) {
                        await this.persist(running);
                        lastWriteAt = running.current.updatedAt;
                    }
                }
            } finally {
                reader.releaseLock();
            }

            await writable.close();
            writable = null;
            const expected = running.current.totalBytes;
            if (prepared.response.status === 206 && expected === null) {
                throw new DownloadCoreError(
                    'incomplete',
                    'The server did not report the final media size; resume to verify completion.'
                );
            }
            if (expected !== null && bytesDownloaded < expected) {
                throw new DownloadCoreError(
                    'incomplete',
                    `The transfer ended at ${bytesDownloaded} of ${expected} bytes.`
                );
            }

            const completedAt = this.now();
            running.current = {
                ...running.current,
                bytesDownloaded,
                completedAt,
                error: null,
                errorCode: null,
                status: 'completed',
                totalBytes: expected === null ? bytesDownloaded : Math.max(expected, bytesDownloaded),
                updatedAt: completedAt
            };
            await this.persist(running);
        } catch (cause) {
            if (!running.controller.signal.aborted) running.controller.abort();
            await response?.body?.cancel().catch(() => undefined);
            if (writable) {
                try {
                    await writable.close();
                } catch {
                    // Preserve the transfer error, which is more actionable.
                }
                try {
                    bytesDownloaded = await getDownloadFileSize(running.current.id);
                } catch {
                    // Keep the last streamed byte count when OPFS cannot be inspected.
                }
            }
            const failure = classifyDownloadError(cause);
            const paused = running.pauseRequested || failure.code === 'aborted';
            running.current = {
                ...running.current,
                bytesDownloaded,
                error: paused ? null : failure.message,
                errorCode: paused ? null : failure.code,
                status: paused ? 'paused' : 'failed',
                updatedAt: this.now()
            };
            await this.persist(running);
        }
    }

    private async prepareResponse(
        record: DownloadRecord,
        authHeaders: HeadersInit,
        offset: number,
        signal: AbortSignal
    ): Promise<PreparedResponse> {
        let response = await this.fetchMedia(record, authHeaders, offset, signal);
        let decision = decideDownloadResponse(
            response.status,
            response.headers,
            offset,
            record.totalBytes
        );

        if (decision.action === 'complete') {
            return {
                alreadyComplete: true,
                offset: decision.offset,
                response,
                totalBytes: decision.totalBytes
            };
        }

        if (decision.action === 'retry') {
            await response.body?.cancel().catch(() => undefined);
            response = await this.fetchMedia(record, authHeaders, 0, signal);
            decision = decideDownloadResponse(
                response.status,
                response.headers,
                0,
                decision.totalBytes
            );
        }

        if (decision.action === 'reject' || decision.action === 'retry') {
            await response.body?.cancel().catch(() => undefined);
            const code = response.status === 401 || response.status === 403
                ? 'authentication'
                : 'http';
            throw new DownloadCoreError(
                code,
                `The media request failed with HTTP ${response.status}.`,
                response.status
            );
        }

        if (decision.action === 'complete') {
            return {
                alreadyComplete: true,
                offset: decision.offset,
                response,
                totalBytes: decision.totalBytes
            };
        }

        return {
            alreadyComplete: false,
            offset: decision.offset,
            response,
            totalBytes: decision.totalBytes
        };
    }

    private fetchMedia(
        record: DownloadRecord,
        authHeaders: HeadersInit,
        offset: number,
        signal: AbortSignal
    ): Promise<Response> {
        const validator = record.etag ?? record.lastModified;
        return this.fetcher(record.sourceUrl, {
            cache: 'no-store',
            credentials: 'same-origin',
            headers: buildDownloadRequestHeaders(authHeaders, offset, validator),
            signal
        });
    }

    private async persist(running: ActiveDownload): Promise<void> {
        await putDownloadRecord(running.current);
        this.notify();
    }

    private async recoverInterrupted(record: DownloadRecord): Promise<DownloadRecord> {
        const running = this.active.get(record.id);
        if (running) return running.current;
        if (record.status !== 'downloading' || await this.isDownloadLocked(record.id)) {
            return record;
        }

        let bytesDownloaded = record.bytesDownloaded;
        try {
            bytesDownloaded = await getDownloadFileSize(record.id);
        } catch {
            // Metadata remains usable even when OPFS is temporarily unavailable.
        }
        const recovered: DownloadRecord = {
            ...record,
            bytesDownloaded,
            error: null,
            errorCode: null,
            status: 'paused',
            updatedAt: this.now()
        };
        await putDownloadRecord(recovered);
        this.notify();
        return recovered;
    }

    private async isDownloadLocked(id: string): Promise<boolean> {
        // ponytail: without Web Locks there is no safe cross-tab probe; recover
        // stale state locally and keep transfer locking for supported browsers.
        if (!navigator.locks) return false;
        let acquired = false;
        try {
            await navigator.locks.request(
                `jellyfin-web-new-download:${id}`,
                { ifAvailable: true, mode: 'exclusive' },
                lock => {
                    acquired = Boolean(lock);
                }
            );
        } catch {
            return true;
        }
        return !acquired;
    }

    private async withDownloadLock(id: string, transfer: () => Promise<void>): Promise<void> {
        if (!navigator.locks) {
            throw new DownloadCoreError(
                'unsupported',
                'Web Locks are required for safe offline downloads.'
            );
        }

        await navigator.locks.request(
            `jellyfin-web-new-download:${id}`,
            { ifAvailable: true, mode: 'exclusive' },
            async lock => {
                // The owning tab keeps the shared metadata current.
                if (!lock) return;
                await transfer();
            }
        );
    }

    private async withMutationLock<T>(id: string, mutate: () => Promise<T>): Promise<T> {
        if (!navigator.locks) return mutate();

        let acquired = false;
        let result: T | undefined;
        await navigator.locks.request(
            `jellyfin-web-new-download:${id}`,
            { ifAvailable: true, mode: 'exclusive' },
            async lock => {
                if (!lock) return;
                acquired = true;
                result = await mutate();
            }
        );
        if (!acquired) {
            throw new DownloadCoreError(
                'storage',
                'This download is active in another tab.'
            );
        }
        return result as T;
    }
}

const defaultManager = new DownloadManager();

export const downloadManager = defaultManager;

export function list(scope?: DownloadScope): Promise<DownloadRecord[]> {
    return defaultManager.list(scope);
}

export function get(id: string): Promise<DownloadRecord | null> {
    return defaultManager.get(id);
}

export function getCompletedForItem(
    scope: DownloadProfileScope,
    itemId: string
): Promise<DownloadRecord | null> {
    return defaultManager.getCompletedForItem(scope, itemId);
}

export function start(input: StartDownloadInput): Promise<DownloadRecord> {
    return defaultManager.start(input);
}

export function resume(id: string, input: ResumeDownloadInput): Promise<DownloadRecord> {
    return defaultManager.resume(id, input);
}

export function pause(id: string): Promise<DownloadRecord | null> {
    return defaultManager.pause(id);
}

export function deleteDownload(id: string): Promise<boolean> {
    return defaultManager.delete(id);
}

export function clear(scope: DownloadScope): Promise<number> {
    return defaultManager.clear(scope);
}

export function subscribe(listener: DownloadListener): () => void {
    return defaultManager.subscribe(listener);
}
