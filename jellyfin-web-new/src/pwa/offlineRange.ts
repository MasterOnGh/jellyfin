export interface ResolvedByteRange {
    end: number;
    length: number;
    start: number;
}

export type ByteRangeResolution =
    | { kind: 'full' }
    | { kind: 'partial'; range: ResolvedByteRange }
    | { kind: 'unsatisfiable' };

const OFFLINE_VIDEO_MIME_TYPES = new Set([
    'video/mp2t',
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-matroska'
]);
const VIDEO_MIME_SYNTAX = /^video\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/i;

function parseByteOffset(value: string) {
    if (!/^\d+$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

export function resolveOfflineVideoMimeType(value: string | null) {
    if (value === null
        || value !== value.trim()
        || /[\r\n]/.test(value)
        || !VIDEO_MIME_SYNTAX.test(value)) {
        return null;
    }

    const normalized = value.toLowerCase();
    return OFFLINE_VIDEO_MIME_TYPES.has(normalized) ? normalized : null;
}

export function resolveByteRange(
    rangeHeader: string | null,
    fileSize: number
): ByteRangeResolution {
    if (!Number.isSafeInteger(fileSize) || fileSize < 0) {
        throw new RangeError('File size must be a non-negative safe integer.');
    }
    if (rangeHeader === null) return { kind: 'full' };

    const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
    if (!match) return { kind: 'unsatisfiable' };
    const startText = match[1] ?? '';
    const endText = match[2] ?? '';
    if (!startText && !endText) return { kind: 'unsatisfiable' };

    let start: number;
    let end: number;
    if (!startText) {
        const suffixLength = parseByteOffset(endText);
        if (suffixLength === null || suffixLength === 0 || fileSize === 0) {
            return { kind: 'unsatisfiable' };
        }
        start = Math.max(0, fileSize - suffixLength);
        end = fileSize - 1;
    } else {
        const parsedStart = parseByteOffset(startText);
        const parsedEnd = endText ? parseByteOffset(endText) : fileSize - 1;
        if (parsedStart === null
            || parsedEnd === null
            || fileSize === 0
            || parsedStart >= fileSize
            || parsedEnd < parsedStart) {
            return { kind: 'unsatisfiable' };
        }
        start = parsedStart;
        end = Math.min(parsedEnd, fileSize - 1);
    }

    return {
        kind: 'partial',
        range: {
            end,
            length: end - start + 1,
            start
        }
    };
}
