/**
 * Client-side GIF export: gifenc (MIT) in a Web Worker, encoding frames as they are rendered
 * (streaming), with a bounded in-flight queue, a stall watchdog and early size / memory aborts.
 * Replaces gif.js, which kept every RGBA frame in memory and only checked size at the end.
 */
import { GIF_HARD_MAX_FILE_BYTES } from './gifPlan';

export { getGifSize, planGifExport } from './gifPlan';

const mb = (n: number, digits = 1) => (n / (1024 * 1024)).toFixed(digits);

/** Encoded output went over the (PROVISIONAL) hard cap. */
export class GifTooLargeError extends Error {
    constructor(public readonly size: number, public readonly limit: number = GIF_HARD_MAX_FILE_BYTES) {
        super(`GIF would be about ${mb(size)} MB, over the ${mb(limit, limit < 1024 * 1024 ? 2 : 0)} MB browser limit`);
        this.name = 'GifTooLargeError';
    }
}

/** The tab is close to its JS heap limit; stopped before the browser kills it. */
export class GifMemoryError extends Error {
    constructor() {
        super('This GIF needs more memory than the browser can safely use');
        this.name = 'GifMemoryError';
    }
}

export class GifEncodeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'GifEncodeError';
    }
}

/** Errors that mean "the web app hit its limits" → suggest the macOS app. */
export const isWebLimitError = (e: unknown) => e instanceof GifTooLargeError || e instanceof GifMemoryError;

export const GIF_ENCODE_STALL_TIMEOUT_MS = 60_000;
/** Max frames posted to the worker but not yet encoded (bounds memory: ≤ N × w × h × 4 bytes). */
export const GIF_MAX_FRAMES_IN_FLIGHT = 3;

export interface StreamingGifParams {
    width: number;
    height: number;
    fps: number;
    loop: boolean;
    colors?: number;
    maxBytes?: number;
    stallTimeoutMs?: number;
    maxInFlight?: number;
    /** Test seam. */
    createWorker?: () => Worker;
}

const defaultWorker = () => new Worker(new URL('../workers/gifEncoder.worker.ts', import.meta.url), { type: 'module' });

/**
 * Feed frames with `await addFrame(imageData)` (resolves once there is room in the bounded queue),
 * then `await finish()` for the Blob. Any failure rejects the pending/next call and terminates the worker.
 */
export class StreamingGifEncoder {
    private worker: Worker;
    private inFlight = 0;
    private nextIndex = 0;
    private failed: Error | null = null;
    private waiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
    private doneWaiter: { resolve: (b: Blob) => void; reject: (e: Error) => void } | null = null;
    private stallTimer: number | null = null;
    readonly maxBytes: number;
    private readonly maxInFlight: number;
    private readonly stallTimeoutMs: number;
    bytesWritten = 0;
    framesEncoded = 0;

    constructor(private params: StreamingGifParams) {
        this.maxBytes = params.maxBytes ?? GIF_HARD_MAX_FILE_BYTES;
        this.maxInFlight = params.maxInFlight ?? GIF_MAX_FRAMES_IN_FLIGHT;
        this.stallTimeoutMs = params.stallTimeoutMs ?? GIF_ENCODE_STALL_TIMEOUT_MS;
        this.worker = (params.createWorker ?? defaultWorker)();
        this.worker.onmessage = (e: MessageEvent) => this.onMessage(e.data);
        this.worker.onerror = (e: ErrorEvent) => {
            e.preventDefault?.();
            this.fail(new GifEncodeError(`GIF encoder worker failed${e.message ? `: ${e.message}` : ''}`));
        };
        this.worker.postMessage({
            type: 'init', width: params.width, height: params.height, fps: params.fps, loop: params.loop,
            colors: params.colors ?? 256, maxBytes: this.maxBytes,
        });
    }

    private armStall() {
        if (this.stallTimer !== null) window.clearTimeout(this.stallTimer);
        this.stallTimer = window.setTimeout(
            () => this.fail(new GifEncodeError(`GIF encoding stalled (no progress for ${Math.round(this.stallTimeoutMs / 1000)}s)`)),
            this.stallTimeoutMs
        );
    }

    private onMessage(msg: any) {
        if (this.failed) return;
        if (msg?.type === 'ack') {
            this.inFlight--;
            this.framesEncoded++;
            this.bytesWritten = msg.bytes;
            if (this.inFlight > 0) this.armStall(); else this.clearStall();
            this.waiters.shift()?.resolve();
        } else if (msg?.type === 'tooLarge') {
            this.fail(new GifTooLargeError(msg.bytes, this.maxBytes));
        } else if (msg?.type === 'done') {
            this.clearStall();
            const blob = new Blob([msg.buffer], { type: 'image/gif' });
            this.worker.terminate();
            if (blob.size > this.maxBytes) this.fail(new GifTooLargeError(blob.size, this.maxBytes));
            else this.doneWaiter?.resolve(blob);
        }
    }

    private clearStall() {
        if (this.stallTimer !== null) window.clearTimeout(this.stallTimer);
        this.stallTimer = null;
    }

    fail(err: Error) {
        if (this.failed) return;
        this.failed = err;
        this.clearStall();
        this.worker.terminate();
        this.waiters.splice(0).forEach(w => w.reject(err));
        this.doneWaiter?.reject(err);
    }

    abort() { this.fail(new GifEncodeError('GIF encoding was aborted')); }

    async addFrame(image: ImageData) {
        if (this.failed) throw this.failed;
        if (this.inFlight >= this.maxInFlight) {
            await new Promise<void>((resolve, reject) => this.waiters.push({ resolve, reject }));
        }
        if (this.failed) throw this.failed;
        this.inFlight++;
        this.armStall();
        // Transfer (not copy) the pixel buffer.
        const buf = image.data.buffer;
        this.worker.postMessage({ type: 'frame', index: this.nextIndex++, rgba: buf }, [buf]);
    }

    finish(): Promise<Blob> {
        if (this.failed) return Promise.reject(this.failed);
        return new Promise<Blob>((resolve, reject) => {
            this.doneWaiter = { resolve, reject };
            this.armStall();
            this.worker.postMessage({ type: 'finish' });
        });
    }
}
