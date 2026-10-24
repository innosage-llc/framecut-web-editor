/**
 * Client-side GIF export via gif.js (issue #25).
 * Worker is served from /gif.worker.js (copied into public/).
 */
import GifJs from 'gif.js';
import {
    GIF_MAX_DURATION_S,
    GIF_MAX_FILE_BYTES,
    GifOptions,
    getGifSize,
} from './exportPresets';

export { getGifSize };

// gif.js ships as CJS (`export =`). Vite exposes the constructor as default.
type GifConstructor = new (options?: {
    workers?: number;
    quality?: number;
    width?: number;
    height?: number;
    workerScript?: string;
    repeat?: number;
}) => {
    addFrame: (image: CanvasImageSource | CanvasRenderingContext2D | ImageData, options?: { delay?: number; copy?: boolean }) => void;
    on: (event: 'finished' | 'progress' | 'abort' | 'start', listener: (...args: any[]) => void) => void;
    render: () => void;
    abort: () => void;
};
const GIF = GifJs as unknown as GifConstructor;

export class GifTooLargeError extends Error {
    constructor(public readonly size: number, limit: number = GIF_MAX_FILE_BYTES) {
        super(
            `GIF would be about ${(size / (1024 * 1024)).toFixed(1)} MB, over the ${(limit / (1024 * 1024)).toFixed(limit < 1024 * 1024 ? 2 : 0)} MB limit`
        );
        this.name = 'GifTooLargeError';
    }
}

export interface EncodeGifParams {
    width: number;
    height: number;
    fps: number;
    loop: boolean;
    onProgress?: (p: number) => void;
}

/** Rejects when gif.js stops making progress (e.g. a worker died without reporting). */
export const GIF_ENCODE_STALL_TIMEOUT_MS = 60_000;

export class GifEncodeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'GifEncodeError';
    }
}

type GifJsInternals = {
    freeWorkers?: Worker[];
    activeWorkers?: Worker[];
    imageParts?: Array<{ data: unknown[]; pageSize: number; cursor: number } | null>;
};

/** Bytes encoded so far, from gif.js's finished frame parts (same formula as gif.js finishRendering). */
const encodedBytesSoFar = (gif: GifJsInternals) => {
    let len = 0;
    let done = 0;
    for (const part of gif.imageParts ?? []) {
        if (!part) continue;
        done++;
        len += (part.data.length - 1) * part.pageSize + part.cursor;
    }
    return { len, done };
};

/**
 * Promise wrapper around gif.js render(). Always settles:
 * - rejects with GifTooLargeError as soon as the encoded size (projected from finished frames) is over
 *   the product limit, aborting the workers instead of waiting for the full encode;
 * - rejects with GifEncodeError on a worker error, an abort, or no progress for `stallTimeoutMs`.
 */
export const encodeGifWithGifJs = (
    frames: Array<{ canvas: HTMLCanvasElement } | { imageData: ImageData }>,
    params: EncodeGifParams & { maxBytes?: number; stallTimeoutMs?: number }
): Promise<Blob> => new Promise((resolve, reject) => {
    const maxBytes = params.maxBytes ?? GIF_MAX_FILE_BYTES;
    const stallTimeoutMs = params.stallTimeoutMs ?? GIF_ENCODE_STALL_TIMEOUT_MS;
    const gif = new GIF({
        workers: 2,
        quality: 10,
        width: params.width,
        height: params.height,
        workerScript: '/gif.worker.js',
        repeat: params.loop ? 0 : -1,
    });
    const internals = gif as unknown as GifJsInternals;
    let settled = false;
    let stallTimer: number | null = null;
    const watched = new Set<Worker>();

    const cleanup = () => {
        if (stallTimer !== null) window.clearTimeout(stallTimer);
        stallTimer = null;
    };
    const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        try { gif.abort(); } catch { /* already stopped */ }
        // gif.js abort() only kills *active* workers; idle ones would leak.
        internals.freeWorkers?.forEach(w => w.terminate());
        reject(err);
    };
    const armStallTimer = () => {
        if (stallTimer !== null) window.clearTimeout(stallTimer);
        stallTimer = window.setTimeout(
            () => fail(new GifEncodeError(`GIF encoding stalled (no progress for ${Math.round(stallTimeoutMs / 1000)}s)`)),
            stallTimeoutMs
        );
    };
    const watchWorkers = () => {
        [...(internals.freeWorkers ?? []), ...(internals.activeWorkers ?? [])].forEach(w => {
            if (watched.has(w)) return;
            watched.add(w);
            w.addEventListener('error', (e: ErrorEvent) => {
                e.preventDefault?.();
                fail(new GifEncodeError(`GIF encoder worker failed${e.message ? `: ${e.message}` : ''}`));
            });
        });
    };

    const delay = Math.max(20, Math.round(1000 / params.fps));
    for (const frame of frames) {
        if ('imageData' in frame) {
            gif.addFrame(frame.imageData, { delay, copy: true });
        } else {
            gif.addFrame(frame.canvas, { delay, copy: true });
        }
    }
    gif.on('progress', (p: number) => {
        if (settled) return;
        armStallTimer();
        watchWorkers();
        const { len, done } = encodedBytesSoFar(internals);
        if (done > 0) {
            const projected = Math.round((len / done) * frames.length);
            // Fail fast: abort once the bytes already written are over the cap, or once enough frames
            // are done (≥10%) that the projection is reliable and clearly over it.
            if (len > maxBytes || (done >= Math.max(3, frames.length * 0.1) && projected > maxBytes * 1.1)) {
                fail(new GifTooLargeError(Math.max(len, projected), maxBytes));
                return;
            }
        }
        params.onProgress?.(p);
    });
    gif.on('abort', () => fail(new GifEncodeError('GIF encoding was aborted')));
    gif.on('finished', (blob: Blob) => {
        if (settled) return;
        if (blob.size > maxBytes) {
            fail(new GifTooLargeError(blob.size, maxBytes));
            return;
        }
        settled = true;
        cleanup();
        resolve(blob);
    });
    try {
        armStallTimer();
        gif.render();
        watchWorkers();
    } catch (e) {
        fail(e instanceof Error ? e : new GifEncodeError(String(e)));
    }
});

export const resolveGifExportPlan = (
    srcWidth: number,
    srcHeight: number,
    duration: number,
    opts: GifOptions
) => {
    const { width, height } = getGifSize(srcWidth, srcHeight, opts.maxLongestSide);
    // Hard length cap always applies.
    const cappedDuration = Math.min(Math.max(0, duration), GIF_MAX_DURATION_S);
    return { width, height, duration: cappedDuration };
};
