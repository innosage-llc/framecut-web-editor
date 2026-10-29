/**
 * #27 Whisper model catalogue (pure: shared by the worker and the main thread).
 * Sizes are the exact bytes transformers.js 4.3.2 fetches for dtype q8 (measured Oct 2026
 * from the Hugging Face API and a real download). Both models are Apache-2.0 on Hugging Face
 * (OpenAI's upstream Whisper weights are MIT). ORT_WASM_BYTES is the self-hosted ONNX Runtime
 * binary, fetched once from the app's own origin.
 */
export type WhisperModelKey = 'tiny' | 'base';

export interface WhisperModelInfo {
  key: WhisperModelKey;
  id: string;
  label: string;
  license: string;
  /** Measured speed vs Standard (single-thread WASM, Chromium, 11 s and 60 s clips). */
  speedNote?: string;
  /** file path inside the repo → bytes */
  files: Record<string, number>;
}

const COMMON = { 'config.json': 2248, 'preprocessor_config.json': 339, 'tokenizer.json': 2480466, 'tokenizer_config.json': 282683 };

export const WHISPER_MODELS: Record<WhisperModelKey, WhisperModelInfo> = {
  tiny: {
    key: 'tiny', id: 'Xenova/whisper-tiny', label: 'Standard', license: 'Apache-2.0',
    files: { ...COMMON, 'generation_config.json': 3716, 'onnx/encoder_model_quantized.onnx': 10124910, 'onnx/decoder_model_merged_quantized.onnx': 30727765 },
  },
  base: {
    key: 'base', id: 'Xenova/whisper-base', label: 'Higher accuracy', license: 'Apache-2.0', speedNote: 'about 2× slower',
    files: { ...COMMON, 'generation_config.json': 3776, 'onnx/encoder_model_quantized.onnx': 23200850, 'onnx/decoder_model_merged_quantized.onnx': 53707539 },
  },
};

export const ORT_WASM_BYTES = 14264838;
export const modelBytes = (m: WhisperModelInfo) => Object.values(m.files).reduce((a, b) => a + b, 0);
/** First-time download in decimal MB, rounded: tiny 58, base 94. */
export const approxDownloadMB = (m: WhisperModelInfo) => Math.round((modelBytes(m) + ORT_WASM_BYTES) / 1e6);

/** Cache transformers.js stores model files in; the worker stores the ORT wasm there too. */
export const WHISPER_CACHE_NAME = 'transformers-cache';
export const ORT_WASM_KEY = '__ort_wasm__';

/** URLs currently in the model cache ([] when the Cache API is unavailable). Works in a window or a worker. */
export async function listCachedUrls(): Promise<string[]> {
  try {
    if (typeof caches === 'undefined') return [];
    return (await (await caches.open(WHISPER_CACHE_NAME)).keys()).map(r => r.url);
  } catch { return []; }
}

const isCachedFile = (m: WhisperModelInfo, file: string, urls: string[]) =>
  urls.some(u => u.includes(`/${m.id}/resolve/`) && u.endsWith('/' + file));

/**
 * What a run would still download, per file (bytes): the model files not yet in the cache, plus
 * the shared ONNX Runtime wasm unless it's cached. Empty object = nothing to download.
 */
export function missingFiles(m: WhisperModelInfo, cachedUrls: string[], wasmUrl: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [f, n] of Object.entries(m.files)) if (!isCachedFile(m, f, cachedUrls)) out[f] = n;
  if (!cachedUrls.includes(wasmUrl)) out[ORT_WASM_KEY] = ORT_WASM_BYTES;
  return out;
}
export const sumBytes = (files: Record<string, number>) => Object.values(files).reduce((a, b) => a + b, 0);
/** Decimal MB for UI copy; anything still missing shows at least 1 MB. */
export const bytesToMB = (b: number) => (b <= 0 ? 0 : Math.max(1, Math.round(b / 1e6)));

/**
 * One combined, never-decreasing progress figure across everything this run downloads.
 * transformers.js reports per-file progress as it discovers files, so summing only the files
 * seen so far made the percentage jump back (100% → 15%). The denominator is the full set of
 * files still missing (default: every model file) instead; already-cached files are left out
 * so a partial download still runs 0 → 100%.
 */
export function createCombinedProgress(m: WhisperModelInfo, files: Record<string, number> = m.files) {
  const total = Math.max(1, sumBytes(files));
  const loaded: Record<string, number> = {};
  let last = 0;
  return (file: string, bytes: number): number => {
    const key = Object.keys(files).find(f => file === f || file.endsWith('/' + f));
    if (key && Number.isFinite(bytes)) loaded[key] = Math.max(loaded[key] ?? 0, Math.min(files[key], bytes));
    const p = Math.min(1, sumBytes(loaded) / total);
    last = Math.max(last, p);
    return last;
  };
}
