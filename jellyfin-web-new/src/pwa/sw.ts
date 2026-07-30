/// <reference lib="webworker" />

import {
    resolveByteRange,
    resolveOfflineVideoMimeType
} from './offlineRange';

declare const self: ServiceWorkerGlobalScope & {
    __WB_MANIFEST: Array<{ revision?: string | null; url: string }>;
};

const CACHE_PREFIX = 'jellyfin-web-new-shell-';
const PRECACHE_EXTENSION = /\.(?:html|css|js|woff2|svg|png|ico|json)$/i;
const FORBIDDEN_RUNTIME_PATH = /\/(?:Videos|Audio|Sessions|Users|CustomNetflix|Items\/[^/]+\/PlaybackInfo)(?:\/|$)/i;
const OFFLINE_MEDIA_DIRECTORY = 'jellyfin-web-new-downloads';
const OFFLINE_MEDIA_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const OFFLINE_MEDIA_PATH = new URL('offline-media/', self.registration.scope).pathname;
const precacheEntries = self.__WB_MANIFEST
    .filter(entry => PRECACHE_EXTENSION.test(new URL(entry.url, self.registration.scope).pathname));
const precacheUrls = [ ...new Set(precacheEntries.map(entry => entry.url)) ];

function manifestVersion(entries: typeof precacheEntries) {
    const serialized = entries
        .map(entry => `${entry.url}\0${entry.revision ?? ''}`)
        .sort()
        .join('\n');
    let hash = 0x811c9dc5;
    for (let index = 0; index < serialized.length; index += 1) {
        hash ^= serialized.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}

const CACHE_NAME = `${CACHE_PREFIX}${manifestVersion(precacheEntries)}`;

function offlineHeaders(file: File, requestedType: string | null) {
    return new Headers({
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, no-store',
        'Content-Type': requestedType || file.type || 'application/octet-stream'
    });
}

function offlineError(status: number, fileSize?: number) {
    const headers = new Headers({
        'Cache-Control': 'private, no-store'
    });
    if (status === 416 && fileSize !== undefined) {
        headers.set('Accept-Ranges', 'bytes');
        headers.set('Content-Range', `bytes */${fileSize}`);
    }
    return new Response(null, { headers, status });
}

async function serveOfflineMedia(
    request: Request,
    encodedId: string,
    requestedType: string | null
) {
    let id: string;
    try {
        id = decodeURIComponent(encodedId);
    } catch {
        return offlineError(404);
    }
    if (!OFFLINE_MEDIA_ID.test(id)) return offlineError(404);
    id = id.toLowerCase();

    try {
        const root = await navigator.storage.getDirectory();
        const downloads = await root.getDirectoryHandle(OFFLINE_MEDIA_DIRECTORY);
        const handle = await downloads.getFileHandle(`${id}.media`);
        const file = await handle.getFile();
        const resolution = resolveByteRange(request.headers.get('Range'), file.size);
        if (resolution.kind === 'unsatisfiable') return offlineError(416, file.size);

        const headers = offlineHeaders(file, requestedType);
        if (resolution.kind === 'full') {
            headers.set('Content-Length', String(file.size));
            return new Response(request.method === 'HEAD' ? null : file, {
                headers,
                status: 200
            });
        }

        const { end, length, start } = resolution.range;
        headers.set('Content-Length', String(length));
        headers.set('Content-Range', `bytes ${start}-${end}/${file.size}`);
        return new Response(
            request.method === 'HEAD' ? null : file.slice(start, end + 1),
            { headers, status: 206 }
        );
    } catch (error) {
        if (error instanceof DOMException && error.name === 'NotFoundError') {
            return offlineError(404);
        }
        return offlineError(503);
    }
}

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(precacheUrls))
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(names => Promise.all(
                names
                    .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
                    .map(name => caches.delete(name))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    if (url.origin === self.location.origin
        && (request.method === 'GET' || request.method === 'HEAD')
        && url.pathname.startsWith(OFFLINE_MEDIA_PATH)) {
        event.respondWith(serveOfflineMedia(
            request,
            url.pathname.slice(OFFLINE_MEDIA_PATH.length),
            resolveOfflineVideoMimeType(url.searchParams.get('type'))
        ));
        return;
    }

    if (request.method !== 'GET') return;
    if (url.origin !== self.location.origin || FORBIDDEN_RUNTIME_PATH.test(url.pathname)) return;

    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request).catch(async () => {
                const cache = await caches.open(CACHE_NAME);
                return await cache.match(
                    new URL('index.html', self.registration.scope).toString(),
                    { ignoreVary: true }
                )
                    ?? Response.error();
            })
        );
        return;
    }

    event.respondWith(
        caches.open(CACHE_NAME)
            .then(cache => cache.match(request, { ignoreVary: true }))
            .then(cached => cached ?? fetch(request))
    );
});

export {};
