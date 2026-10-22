/**
 * Minimal client-side GIF89a encoder (no external dependencies).
 *
 * - Fixed 6x7x6 RGB palette (252 colours) with nearest-colour mapping, so
 *   encoding is fast and deterministic. Quality is adequate for screen
 *   recordings; no dithering is applied.
 * - Standard variable-width LZW compression.
 * - Optional NETSCAPE2.0 loop extension (loop forever or play once).
 */

export interface GifEncoderOptions {
    width: number;
    height: number;
    /** Frames per second; converted to centisecond frame delays. */
    fps: number;
    /** true = loop forever, false = play once. */
    loop: boolean;
}

const R_LEVELS = 6;
const G_LEVELS = 7;
const B_LEVELS = 6;

const buildPalette = (): Uint8Array => {
    const palette = new Uint8Array(256 * 3);
    let i = 0;
    for (let r = 0; r < R_LEVELS; r++) {
        for (let g = 0; g < G_LEVELS; g++) {
            for (let b = 0; b < B_LEVELS; b++) {
                palette[i++] = Math.round((r * 255) / (R_LEVELS - 1));
                palette[i++] = Math.round((g * 255) / (G_LEVELS - 1));
                palette[i++] = Math.round((b * 255) / (B_LEVELS - 1));
            }
        }
    }
    return palette; // remaining entries stay black
};

const PALETTE = buildPalette();

/** Map RGBA pixels to palette indices. */
export const quantizeRgba = (rgba: Uint8ClampedArray | Uint8Array, pixelCount: number): Uint8Array => {
    const out = new Uint8Array(pixelCount);
    for (let p = 0, o = 0; p < pixelCount; p++, o += 4) {
        const r = Math.round((rgba[o] * (R_LEVELS - 1)) / 255);
        const g = Math.round((rgba[o + 1] * (G_LEVELS - 1)) / 255);
        const b = Math.round((rgba[o + 2] * (B_LEVELS - 1)) / 255);
        out[p] = (r * G_LEVELS + g) * B_LEVELS + b;
    }
    return out;
};

class ByteWriter {
    private chunks: Uint8Array[] = [];
    private buf = new Uint8Array(1 << 16);
    private pos = 0;

    byte(v: number) {
        if (this.pos >= this.buf.length) this.flush();
        this.buf[this.pos++] = v & 0xff;
    }
    word(v: number) { this.byte(v); this.byte(v >> 8); }
    bytes(arr: ArrayLike<number>) { for (let i = 0; i < arr.length; i++) this.byte(arr[i]); }
    string(s: string) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); }
    private flush() {
        this.chunks.push(this.buf.slice(0, this.pos));
        this.pos = 0;
    }
    result(): Uint8Array[] {
        this.flush();
        return this.chunks;
    }
}

/** LZW-compress palette indices into GIF sub-blocks. */
const writeLzw = (w: ByteWriter, indices: Uint8Array, minCodeSize: number) => {
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let nextCode = eoiCode + 1;
    let dict = new Map<number, number>();

    const block = new Uint8Array(255);
    let blockLen = 0;
    let bitBuf = 0;
    let bitCount = 0;

    const emitByte = (b: number) => {
        block[blockLen++] = b;
        if (blockLen === 255) {
            w.byte(255);
            w.bytes(block);
            blockLen = 0;
        }
    };
    const emit = (code: number) => {
        bitBuf |= code << bitCount;
        bitCount += codeSize;
        while (bitCount >= 8) {
            emitByte(bitBuf & 0xff);
            bitBuf >>>= 8;
            bitCount -= 8;
        }
    };

    w.byte(minCodeSize);
    emit(clearCode);

    if (indices.length > 0) {
        let prefix = indices[0];
        for (let i = 1; i < indices.length; i++) {
            const k = indices[i];
            const key = (prefix << 8) | k;
            const existing = dict.get(key);
            if (existing !== undefined) {
                prefix = existing;
                continue;
            }
            emit(prefix);
            if (nextCode < 4096) {
                dict.set(key, nextCode++);
                if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
            } else {
                emit(clearCode);
                dict = new Map();
                codeSize = minCodeSize + 1;
                nextCode = eoiCode + 1;
            }
            prefix = k;
        }
        emit(prefix);
    }
    emit(eoiCode);
    if (bitCount > 0) emitByte(bitBuf & 0xff);
    if (blockLen > 0) {
        w.byte(blockLen);
        w.bytes(block.subarray(0, blockLen));
    }
    w.byte(0); // block terminator
};

export class GifEncoder {
    private w = new ByteWriter();
    private delayCs: number;
    private finished = false;
    frameCount = 0;

    constructor(private opts: GifEncoderOptions) {
        if (opts.width <= 0 || opts.height <= 0 || opts.width > 65535 || opts.height > 65535) {
            throw new Error('Invalid GIF dimensions');
        }
        if (!(opts.fps > 0)) throw new Error('Invalid GIF frame rate');
        this.delayCs = Math.max(2, Math.round(100 / opts.fps));
        const w = this.w;
        w.string('GIF89a');
        w.word(opts.width);
        w.word(opts.height);
        w.byte(0xf7); // global colour table, 8 bits/channel, 256 entries
        w.byte(0);    // background colour index
        w.byte(0);    // pixel aspect ratio
        w.bytes(PALETTE);
        if (opts.loop) {
            w.byte(0x21); w.byte(0xff); w.byte(11);
            w.string('NETSCAPE2.0');
            w.byte(3); w.byte(1); w.word(0); w.byte(0);
        }
    }

    /** Add one RGBA frame (e.g. ImageData.data) of exactly width x height. */
    addFrame(rgba: Uint8ClampedArray | Uint8Array) {
        if (this.finished) throw new Error('GIF already finished');
        const { width, height } = this.opts;
        const pixels = width * height;
        if (rgba.length < pixels * 4) throw new Error('Frame data too small');
        const w = this.w;
        // Graphic control extension
        w.byte(0x21); w.byte(0xf9); w.byte(4);
        w.byte(0x04); // disposal: do not dispose
        w.word(this.delayCs);
        w.byte(0); w.byte(0);
        // Image descriptor
        w.byte(0x2c);
        w.word(0); w.word(0);
        w.word(width); w.word(height);
        w.byte(0);
        writeLzw(w, quantizeRgba(rgba, pixels), 8);
        this.frameCount++;
    }

    finish(): Blob {
        this.finished = true;
        this.w.byte(0x3b);
        return new Blob(this.w.result() as BlobPart[], { type: 'image/gif' });
    }
}

/** Compute an even-sized output resolution for a source canvas, capped to maxWidth. */
export const getGifSize = (srcWidth: number, srcHeight: number, maxWidth: number) => {
    const scale = Math.min(1, maxWidth / srcWidth);
    const width = Math.max(2, Math.round((srcWidth * scale) / 2) * 2);
    const height = Math.max(2, Math.round((srcHeight * scale) / 2) * 2);
    return { width, height };
};
