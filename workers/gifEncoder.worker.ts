/// <reference lib="webworker" />
/**
 * Streaming GIF encoder (gifenc, MIT). Frames are quantized and written as they arrive, so the worker
 * holds only the encoded output plus one frame, never the whole RGBA sequence.
 */
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

type InitMsg = { type: 'init'; width: number; height: number; fps: number; loop: boolean; colors: number; maxBytes: number };
type FrameMsg = { type: 'frame'; index: number; rgba: ArrayBuffer };
type FinishMsg = { type: 'finish' };
type Msg = InitMsg | FrameMsg | FinishMsg;

let enc: ReturnType<typeof GIFEncoder> | null = null;
let cfg: InitMsg | null = null;
let aborted = false;

self.onmessage = (e: MessageEvent<Msg>) => {
    const msg = e.data;
    if (msg.type === 'init') {
        cfg = msg;
        enc = GIFEncoder();
        aborted = false;
        return;
    }
    if (!enc || !cfg || aborted) return;
    if (msg.type === 'frame') {
        const rgba = new Uint8Array(msg.rgba);
        const palette = quantize(rgba, cfg.colors, { format: 'rgb444' });
        const index = applyPalette(rgba, palette, 'rgb444');
        enc.writeFrame(index, cfg.width, cfg.height, {
            palette,
            delay: Math.max(20, Math.round(1000 / cfg.fps)),
            repeat: cfg.loop ? 0 : -1,
        });
        const bytes = enc.bytesView().length;
        if (bytes > cfg.maxBytes) {
            aborted = true;
            enc = null;
            (self as any).postMessage({ type: 'tooLarge', bytes, index: msg.index });
            return;
        }
        (self as any).postMessage({ type: 'ack', index: msg.index, bytes });
        return;
    }
    if (msg.type === 'finish') {
        enc.finish();
        const out = enc.bytes();
        enc = null;
        (self as any).postMessage({ type: 'done', buffer: out.buffer }, [out.buffer]);
    }
};
