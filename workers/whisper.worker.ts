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
import { WHISPER_MODELS, WhisperModelKey, createCombinedProgress } from '../utils/whisperModels';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';


env.allowLocalModels = false;
env.useBrowserCache = true;
const onnx = (env.backends as any).onnx;
onnx.wasm.wasmPaths = { wasm: ortWasmUrl };
onnx.wasm.numThreads = 1; // app is not cross-origin isolated; avoid SharedArrayBuffer

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
    const combined = createCombinedProgress(model);
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
