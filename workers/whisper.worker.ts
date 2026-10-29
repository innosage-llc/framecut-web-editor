/// <reference lib="webworker" />
/// <reference types="vite/client" />
/**
 * #27 On-device speech-to-text: Whisper tiny (Xenova/whisper-tiny, 8-bit quantized ONNX)
 * via transformers.js, CPU/WASM only. Only created after the user opted in to the download.
 * Model files come from huggingface.co and are cached by transformers.js in the browser
 * Cache API; the ONNX Runtime WASM binary is self-hosted with the app (no third-party CDN).
 *
 * Protocol: see utils/transcriber.ts. The request carries 16 kHz mono PCM in `audio`.
 */
import { pipeline, env } from '@huggingface/transformers';
import { groupWordsIntoSegments } from '../utils/whisperWords';
import { WHISPER_MODELS, WhisperModelKey, createCombinedProgress, listCachedUrls, missingFiles, ORT_WASM_KEY, WHISPER_CACHE_NAME } from '../utils/whisperModels';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';


env.allowLocalModels = false;
env.useBrowserCache = true;
const onnx = (env.backends as any).onnx;
onnx.wasm.wasmPaths = { wasm: ortWasmUrl };
// Multi-threaded WASM needs SharedArrayBuffer, i.e. a cross-origin-isolated page (COOP/COEP
// headers). Measured: 4 threads ran 1.5x (tiny) / 1.7x (base) faster with identical text. The
// app is not isolated today, so this stays single-threaded until those headers are served.
onnx.wasm.numThreads = (self as any).crossOriginIsolated ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1)) : 1;
const ORT_WASM_URL = new URL(ortWasmUrl, self.location.href).href;

/**
 * Fetch the ONNX Runtime wasm through the same Cache API store as the model files, so the main
 * thread can tell whether it is already downloaded (and size the prompt accordingly).
 */
async function loadOrtWasm(onBytes: (n: number) => void): Promise<ArrayBuffer | null> {
  try {
    const cache = await caches.open(WHISPER_CACHE_NAME);
    const hit = await cache.match(ORT_WASM_URL);
    if (hit) return await hit.arrayBuffer();
    const res = await fetch(ORT_WASM_URL);
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader(); const parts: Uint8Array[] = []; let n = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); n += value.length; onBytes(n); }
    const buf = new Uint8Array(n); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
    try { await cache.put(ORT_WASM_URL, new Response(buf, { headers: { 'Content-Type': 'application/wasm' } })); } catch {}
    return buf.buffer;
  } catch { return null; }
}
let wasmReady: Promise<void> | null = null;

const asr: Partial<Record<WhisperModelKey, Promise<any>>> = {};

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  if (!m || m.type !== 'transcribe') return;
  const post = (msg: any) => (self as unknown as Worker).postMessage({ ...msg, id: m.id });
  try {
    const audio: Float32Array = m.request.audio;
    if (!audio || audio.length === 0) { post({ type: 'result', segments: [] }); return; }
    const key: WhisperModelKey = m.request.model === 'base' ? 'base' : 'tiny';
    const model = WHISPER_MODELS[key];
    const missing = missingFiles(model, await listCachedUrls(), ORT_WASM_URL);
    const combined = createCombinedProgress(model, missing);
    wasmReady ??= loadOrtWasm(n => post({ type: 'progress', phase: 'download', progress: combined(ORT_WASM_KEY, n) }))
      .then(bin => { if (bin) onnx.wasm.wasmBinary = bin; });
    await wasmReady;
    asr[key] ??= pipeline('automatic-speech-recognition', model.id, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p: any) => {
        if (p?.status === 'progress' && p.file) post({ type: 'progress', phase: 'download', progress: combined(p.file, p.loaded ?? 0) });
      },
    });
    const transcriber = await asr[key];
    post({ type: 'progress', phase: 'transcribe', progress: 0 });
    // No `language`: Whisper auto-detects. Word timestamps (same model files, cross-attention
    // alignment) let FrameCut cut cues into subtitle-sized lines and trim text with the timing.
    // Decoding settings were measured on the JFK sample (clean, x3, noisy) in Oct 2026: forcing
    // language 'en', num_beams 3, stride 3 s or 20 s chunks gave no gain (or a loss), and
    // no_repeat_ngram_size 3 broke legitimately repeated phrases (WER 0% → 15%), so defaults stay.
    const out = await transcriber(audio, { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5, task: 'transcribe' });
    const segments = groupWordsIntoSegments(out?.chunks ?? [], audio.length / 16000);
    post({ type: 'result', segments });
  } catch (err: any) {
    delete asr[m.request?.model === 'base' ? 'base' : 'tiny'];
    post({ type: 'error', message: err?.message || String(err) });
  }
};
export {};
