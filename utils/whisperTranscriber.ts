/**
 * #27 Default transcriber: on-device Whisper tiny (multilingual, auto language detection).
 * Nothing is downloaded until the user confirms the size warning. Audio is decoded on the
 * main thread (Web Audio, resampled to 16 kHz mono); no-audio / silent media short-circuit to
 * "no speech" without ever creating the worker or touching the network.
 */
import { Transcriber, TranscriptSegment, createWorkerTranscriber, unavailableTranscriber } from './transcriber';

export const WHISPER_MODEL_ID = 'Xenova/whisper-tiny';
/** Files transformers.js fetches for dtype q8 (sizes from the Hub, Oct 2026). */
export const WHISPER_MODEL_FILES = [
  'config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json',
  'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx',
];
/** ~41 MB model (q8 encoder 10.1 MB + merged decoder 30.7 MB + ~3 MB tokenizer/config) + ~14 MB ONNX Runtime WASM. */
export const WHISPER_APPROX_DOWNLOAD_MB = 55;
export const WEB_TRANSCRIBE_LIMIT_SECONDS = 10 * 60;

export async function isWhisperModelCached(): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false;
    const cache = await caches.open('transformers-cache');
    const keys = (await cache.keys()).map(r => r.url);
    return ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx']
      .every(f => keys.some(k => k.includes(`${WHISPER_MODEL_ID}/resolve/`) && k.endsWith(f)));
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

/** Drop Whisper non-speech markers like "[BLANK_AUDIO]", "(music)", "[Music]". */
export const cleanWhisperSegments = (segs: TranscriptSegment[]) =>
  segs.map(s => ({ ...s, text: s.text.replace(/\[[^\]]*\]|\([^)]*\)/g, '').replace(/\s+/g, ' ').trim() })).filter(s => s.text !== '');

export interface WhisperDeps {
  makeWorker?: () => Worker;
  decodeAudio?: (src: string) => Promise<Float32Array | null>;
  isReady?: () => Promise<boolean>;
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
  return {
    id: 'whisper-tiny',
    download: { approxMB: WHISPER_APPROX_DOWNLOAD_MB, source: 'Hugging Face (huggingface.co)', isReady: deps.isReady ?? isWhisperModelCached },
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
      const segs = await inner.transcribe({ ...req, audio: pcm }, signal, onProgress);
      return cleanWhisperSegments(segs);
    },
  };
}
