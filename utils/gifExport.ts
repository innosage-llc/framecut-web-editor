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
    constructor(public readonly size: number) {
        super(
            `GIF is ${(size / (1024 * 1024)).toFixed(1)} MB, over the ${Math.round(GIF_MAX_FILE_BYTES / (1024 * 1024))} MB limit`
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

/** Promise wrapper around gif.js render(). Rejects with GifTooLargeError if over the product limit. */
export const encodeGifWithGifJs = (
    frames: Array<{ canvas: HTMLCanvasElement } | { imageData: ImageData }>,
    params: EncodeGifParams
): Promise<Blob> => new Promise((resolve, reject) => {
    const gif = new GIF({
        workers: 2,
        quality: 10,
        width: params.width,
        height: params.height,
        workerScript: '/gif.worker.js',
        repeat: params.loop ? 0 : -1,
    });
    const delay = Math.max(20, Math.round(1000 / params.fps));
    for (const frame of frames) {
        if ('imageData' in frame) {
            gif.addFrame(frame.imageData, { delay, copy: true });
        } else {
            gif.addFrame(frame.canvas, { delay, copy: true });
        }
    }
    gif.on('progress', (p: number) => params.onProgress?.(p));
    gif.on('finished', (blob: Blob) => {
        if (blob.size > GIF_MAX_FILE_BYTES) {
            reject(new GifTooLargeError(blob.size));
            return;
        }
        resolve(blob);
    });
    try {
        gif.render();
    } catch (e) {
        reject(e);
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
