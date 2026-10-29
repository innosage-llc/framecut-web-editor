/**
 * #27 Default transcriber: on-device Whisper tiny (multilingual, auto language detection).
 * Nothing is downloaded until the user confirms the size warning. Audio is decoded on the
 * main thread (Web Audio, resampled to 16 kHz mono); no-audio / silent media short-circuit to
 * "no speech" without ever creating the worker or touching the network.
 */
import { Transcriber, TranscriptSegment, createWorkerTranscriber, unavailableTranscriber } from './transcriber';
import { WHISPER_MODELS, WhisperModelKey, approxDownloadMB } from './whisperModels';
export { WHISPER_MODELS, approxDownloadMB } from './whisperModels';
export type { WhisperModelKey } from './whisperModels';

const MODEL_PREF_KEY = 'framecut-whisper-model';
const modelListeners = new Set<() => void>();
let modelChoice: WhisperModelKey = (() => {
  try { return localStorage.getItem(MODEL_PREF_KEY) === 'base' ? 'base' : 'tiny'; } catch { return 'tiny'; }
})();
/** Which Whisper model the default engine uses: 'tiny' (Standard) or 'base' (Higher accuracy, opt-in). */
export const getWhisperModel = (): WhisperModelKey => modelChoice;
export function setWhisperModel(k: WhisperModelKey) {
  modelChoice = k === 'base' ? 'base' : 'tiny';
  try { localStorage.setItem(MODEL_PREF_KEY, modelChoice); } catch {}
  modelListeners.forEach(l => l());
}
export const subscribeWhisperModel = (l: () => void) => { modelListeners.add(l); return () => { modelListeners.delete(l); }; };

export const WHISPER_MODEL_ID = WHISPER_MODELS.tiny.id;
/** Files transformers.js fetches for dtype q8 (sizes from the Hub, Oct 2026). */
export const WHISPER_MODEL_FILES = [
  'config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json',
  'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx',
];
/** Standard model: 43.6 MB (q8 encoder 10.1 + merged decoder 30.7 + tokenizer/config 2.8) + 14.3 MB ONNX Runtime WASM. */
export const WHISPER_APPROX_DOWNLOAD_MB = approxDownloadMB(WHISPER_MODELS.tiny); // 58
export const WEB_TRANSCRIBE_LIMIT_SECONDS = 10 * 60;

export async function isWhisperModelCached(key: WhisperModelKey = 'tiny'): Promise<boolean> {
  const id = WHISPER_MODELS[key].id;
  try {
    if (typeof caches === 'undefined') return false;
    const cache = await caches.open('transformers-cache');
    const keys = (await cache.keys()).map(r => r.url);
    return ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx']
      .every(f => keys.some(k => k.includes(`${id}/resolve/`) && k.endsWith(f)));
  } catch { return false; }
}

/** Decode the media's audio to 16 kHz mono. Returns null when there is no decodable audio track. */
export async function decodeAudio16k(src: string): Promise<Float32Array | null> {
  const buf = await (await fetch(src)).arrayBuffer();
  let audio: AudioBuffer;
  try {
    const ctx = new OfflineAudioContext(1, 1, 16000);
    audio = await ctx.decodeAudioData(buf);
  } catch {
    return null; // no audio track (or undecodable) → no speech
  }
  if (audio.length === 0) return null;
  const out = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const ch = audio.getChannelData(c);
    for (let i = 0; i < ch.length; i++) out[i] += ch[i] / audio.numberOfChannels;
  }
  return out;
}

/** True when no 50 ms window rises above ~-40 dBFS RMS. Whisper tends to hallucinate on silence. */
export function isSilent(pcm: Float32Array, sampleRate = 16000, threshold = 0.01): boolean {
  const win = Math.max(1, Math.round(sampleRate * 0.05));
  for (let i = 0; i < pcm.length; i += win) {
    let sum = 0; const end = Math.min(pcm.length, i + win);
    for (let j = i; j < end; j++) sum += pcm[j] * pcm[j];
    if (Math.sqrt(sum / (end - i)) > threshold) return false;
  }
  return true;
}

const stripMarkers = (t: string) => t.replace(/\[[^\]]*\]|\([^)]*\)/g, '');

/** Drop Whisper non-speech markers like "[BLANK_AUDIO]", "(music)", "[Music]" (from words too). */
export const cleanWhisperSegments = (segs: TranscriptSegment[]): TranscriptSegment[] =>
  segs.map(s => {
    const out: TranscriptSegment = { start: s.start, end: s.end, text: stripMarkers(s.text).replace(/\s+/g, ' ').trim() };
    if (s.words) {
      const words = s.words.filter(w => stripMarkers(w.text).trim() !== '');
      if (words.length) { out.words = words; out.text = words.map(w => w.text).join('').replace(/\s+/g, ' ').trim(); }
    }
    return out;
  }).filter(s => s.text !== '');

export { groupWordsIntoSegments, CUE_MAX_SECONDS, CUE_MAX_CHARS, CUE_MAX_GAP_SECONDS } from './whisperWords';

export interface WhisperDeps {
  makeWorker?: () => Worker;
  decodeAudio?: (src: string) => Promise<Float32Array | null>;
  isReady?: (model: WhisperModelKey) => Promise<boolean>;
  /** Model choice; defaults to the user's saved choice (getWhisperModel). */
  model?: () => WhisperModelKey;
}

export const defaultWhisperWorker = () =>
  new Worker(new URL('../workers/whisper.worker.ts', import.meta.url), { type: 'module' });

export function createWhisperTranscriber(deps: WhisperDeps = {}): Transcriber {
  const makeWorker = deps.makeWorker ?? defaultWhisperWorker;
  const decode = deps.decodeAudio ?? decodeAudio16k;
  const inner = createWorkerTranscriber(makeWorker, { id: 'whisper-tiny' });
  // Decoded audio is cached per source so the pre-prompt speech check doesn't decode twice.
  let cached: { src: string; pcm: Float32Array | null } | null = null;
  const getPcm = async (src: string) => {
    if (cached?.src !== src) cached = { src, pcm: await decode(src) };
    return cached.pcm;
  };
  const model = deps.model ?? getWhisperModel;
  const isReady = deps.isReady ?? isWhisperModelCached;
  return {
    get id() { return `whisper-${model()}`; },
    download: {
      get approxMB() { return approxDownloadMB(WHISPER_MODELS[model()]); },
      get label() { return WHISPER_MODELS[model()].label; },
      source: 'Hugging Face (huggingface.co)',
      isReady: () => isReady(model()),
    },
    availability: () => {
      const ok = typeof WebAssembly !== 'undefined' && typeof Worker !== 'undefined' && typeof OfflineAudioContext !== 'undefined';
      return ok ? { available: true } : unavailableTranscriber.availability();
    },
    async hasSpeech(req) {
      const pcm = await getPcm(req.mediaSrc);
      return !!pcm && !isSilent(pcm);
    },
    async transcribe(req, signal, onProgress) {
      const pcm = await getPcm(req.mediaSrc);
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!pcm || isSilent(pcm)) return [];
      const segs = await inner.transcribe({ ...req, audio: pcm, model: model() }, signal, onProgress);
      return cleanWhisperSegments(segs);
    },
  };
}
