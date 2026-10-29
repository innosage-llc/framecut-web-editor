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
    key: 'base', id: 'Xenova/whisper-base', label: 'Higher accuracy', license: 'Apache-2.0',
    files: { ...COMMON, 'generation_config.json': 3776, 'onnx/encoder_model_quantized.onnx': 23200850, 'onnx/decoder_model_merged_quantized.onnx': 53707539 },
  },
};

export const ORT_WASM_BYTES = 14264838;
export const modelBytes = (m: WhisperModelInfo) => Object.values(m.files).reduce((a, b) => a + b, 0);
/** First-time download in decimal MB, rounded: tiny 58, base 94. */
export const approxDownloadMB = (m: WhisperModelInfo) => Math.round((modelBytes(m) + ORT_WASM_BYTES) / 1e6);

/**
 * One combined, never-decreasing progress figure across all model files. transformers.js
 * reports per-file progress as it discovers files, so summing only the files seen so far made
 * the percentage jump back (100% → 15%). The denominator is the full known manifest instead.
 */
export function createCombinedProgress(m: WhisperModelInfo) {
  const total = modelBytes(m);
  const loaded: Record<string, number> = {};
  let last = 0;
  return (file: string, bytes: number): number => {
    const key = Object.keys(m.files).find(f => file === f || file.endsWith('/' + f));
    if (key && Number.isFinite(bytes)) loaded[key] = Math.max(loaded[key] ?? 0, Math.min(m.files[key], bytes));
    const p = Math.min(1, Object.values(loaded).reduce((a, b) => a + b, 0) / total);
    last = Math.max(last, p);
    return last;
  };
}
