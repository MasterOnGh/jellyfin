import {
    DOWNLOAD_DIRECTORY,
    DownloadCoreError,
    downloadFileName
} from './helpers';

function storageManager(): StorageManager {
    if (!navigator.storage?.getDirectory) {
        throw new DownloadCoreError(
            'unsupported',
            'Origin private file system storage is not supported by this browser.'
        );
    }
    return navigator.storage;
}

async function downloadsDirectory(): Promise<FileSystemDirectoryHandle> {
    const root = await storageManager().getDirectory();
    return root.getDirectoryHandle(DOWNLOAD_DIRECTORY, { create: true });
}

function isNotFound(cause: unknown): boolean {
    return cause instanceof DOMException && cause.name === 'NotFoundError';
}

export async function getDownloadFileHandle(id: string): Promise<FileSystemFileHandle> {
    const directory = await downloadsDirectory();
    return directory.getFileHandle(downloadFileName(id), { create: true });
}

export async function getDownloadFileSize(id: string): Promise<number> {
    try {
        const directory = await downloadsDirectory();
        const handle = await directory.getFileHandle(downloadFileName(id));
        return (await handle.getFile()).size;
    } catch (cause) {
        if (isNotFound(cause)) return 0;
        throw cause;
    }
}

export async function readDownloadFile(id: string): Promise<File | null> {
    try {
        const directory = await downloadsDirectory();
        const handle = await directory.getFileHandle(downloadFileName(id));
        return handle.getFile();
    } catch (cause) {
        if (isNotFound(cause)) return null;
        throw cause;
    }
}

export async function deleteDownloadFile(id: string): Promise<void> {
    try {
        const directory = await downloadsDirectory();
        await directory.removeEntry(downloadFileName(id));
    } catch (cause) {
        if (!isNotFound(cause)) throw cause;
    }
}
