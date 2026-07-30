import {
    createStore,
    del,
    get,
    keys,
    set
} from 'idb-keyval';

import {
    DOWNLOAD_DATABASE,
    DOWNLOAD_METADATA_VERSION,
    DOWNLOAD_OBJECT_STORE,
    isDownloadRecord,
    matchesDownloadScope
} from './helpers';
import type { DownloadRecord, DownloadScope } from './types';

const store = createStore(DOWNLOAD_DATABASE, DOWNLOAD_OBJECT_STORE);
const keyFor = (id: string) => `${DOWNLOAD_METADATA_VERSION}:${id}`;

export async function getDownloadRecord(id: string): Promise<DownloadRecord | null> {
    const value = await get<unknown>(keyFor(id), store);
    if (isDownloadRecord(value)) return value;
    if (value !== undefined) await del(keyFor(id), store);
    return null;
}

export async function listDownloadRecords(scope?: DownloadScope): Promise<DownloadRecord[]> {
    const metadataKeys = (await keys(store))
        .filter((key): key is string =>
            typeof key === 'string'
            && key.startsWith(`${DOWNLOAD_METADATA_VERSION}:`));
    const records = await Promise.all(metadataKeys.map(async key => {
        const value = await get<unknown>(key, store);
        if (isDownloadRecord(value)) return value;
        await del(key, store);
        return null;
    }));

    return records
        .filter((record): record is DownloadRecord =>
            record !== null && matchesDownloadScope(record, scope))
        .sort((left, right) => right.createdAt - left.createdAt);
}

export function putDownloadRecord(record: DownloadRecord): Promise<void> {
    return set(keyFor(record.id), record, store);
}

export function deleteDownloadRecord(id: string): Promise<void> {
    return del(keyFor(id), store);
}
