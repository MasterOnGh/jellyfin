import { DownloadCoreError } from './helpers';
import type { DownloadStorageStatus } from './types';

function nullableNumber(value: number | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function getDownloadStorageStatus(): Promise<DownloadStorageStatus> {
    const manager = navigator.storage;
    const opfsSupported = Boolean(manager?.getDirectory);
    if (!manager) {
        return {
            availableBytes: null,
            opfsSupported,
            persisted: false,
            quotaBytes: null,
            usageBytes: null
        };
    }

    const [ estimate, persisted ] = await Promise.all([
        manager.estimate().catch(() => ({} as StorageEstimate)),
        manager.persisted?.().catch(() => false) ?? Promise.resolve(false)
    ]);
    const quotaBytes = nullableNumber(estimate.quota);
    const usageBytes = nullableNumber(estimate.usage);
    return {
        availableBytes: quotaBytes === null || usageBytes === null
            ? null
            : Math.max(0, quotaBytes - usageBytes),
        opfsSupported,
        persisted,
        quotaBytes,
        usageBytes
    };
}

export async function requestPersistentDownloadStorage(): Promise<boolean> {
    const manager = navigator.storage;
    if (!manager) return false;
    if (await (manager.persisted?.().catch(() => false) ?? false)) return true;
    return manager.persist?.().catch(() => false) ?? false;
}

export async function ensureDownloadCapacity(requiredBytes: number | null): Promise<void> {
    if (requiredBytes === null || requiredBytes <= 0) return;
    const { availableBytes, opfsSupported } = await getDownloadStorageStatus();
    if (!opfsSupported) {
        throw new DownloadCoreError(
            'unsupported',
            'Origin private file system storage is not supported by this browser.'
        );
    }
    if (availableBytes !== null && requiredBytes > availableBytes) {
        throw new DownloadCoreError(
            'quota',
            `The download needs ${requiredBytes} bytes but only ${availableBytes} bytes are available.`
        );
    }
}
