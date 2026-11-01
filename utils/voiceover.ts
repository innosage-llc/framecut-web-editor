import type { Subtitle } from '../types';

export const VOICEOVER_LIMIT_SECONDS = 180;
export const VOICEOVER_SAMPLE_RATE = 24000;
export const VOICEOVER_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const VOICEOVER_VOICES = { af_heart: 'Heart · American English', bf_emma: 'Emma · British English' } as const;
export type VoiceoverVoice = keyof typeof VOICEOVER_VOICES;
export type VoiceoverCue = Pick<Subtitle, 'text' | 'start' | 'end'>;

export function voiceoverCues(subtitles: VoiceoverCue[], duration: number): VoiceoverCue[] {
  if (!Number.isFinite(duration) || duration <= 0 || duration > VOICEOVER_LIMIT_SECONDS) {
    throw new Error('Web voiceover supports projects up to 3 minutes. Use the FrameCut macOS app for longer projects.');
  }
  const cues = subtitles.filter(s => s.text.trim()).map(s => ({ text: s.text.trim(), start: s.start, end: s.end })).sort((a, b) => a.start - b.start);
  if (!cues.length) throw new Error('Add subtitles before generating a voiceover.');
  if (cues.length > 120) throw new Error('Web voiceover supports up to 120 cues. Use the FrameCut macOS app for larger projects.');
  cues.forEach((cue, i) => {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start || cue.end > duration) {
      throw new Error(`Subtitle ${i + 1} has invalid timing. Adjust it before generating.`);
    }
    if (i && cue.start < cues[i - 1].end) throw new Error(`Subtitle ${i + 1} overlaps another cue. Adjust its timing before generating.`);
    if (cue.text.length > 200) throw new Error(`Subtitle ${i + 1} is too long. Split it into cues of 200 characters or fewer.`);
  });
  return cues;
}

export const voiceoverSignature = (subtitles: VoiceoverCue[], duration: number) => JSON.stringify({
  duration, cues: subtitles.filter(s => s.text.trim()).map(s => ({ text: s.text.trim(), start: s.start, end: s.end })).sort((a, b) => a.start - b.start),
});

/** Preserve cue starts and silence; reject overflow rather than cutting off speech. */
export function placeVoiceoverCue(output: Float32Array, samples: Float32Array, cue: VoiceoverCue, index: number) {
  if (!samples.length || samples.some(s => !Number.isFinite(s))) throw new Error(`Subtitle ${index + 1} produced invalid audio.`);
  const start = Math.round(cue.start * VOICEOVER_SAMPLE_RATE);
  const end = Math.min(output.length, Math.round(cue.end * VOICEOVER_SAMPLE_RATE));
  if (samples.length > end - start) throw new Error(`Speech for subtitle ${index + 1} does not fit its timing. Shorten the text or extend the cue, then regenerate.`);
  output.set(samples, start);
}

export interface VoiceoverRequest { cues: VoiceoverCue[]; duration: number; voice: VoiceoverVoice }
export type VoiceoverProgress = (message: string) => void;
export type VoiceoverGenerator = (request: VoiceoverRequest, signal: AbortSignal, progress: VoiceoverProgress) => Promise<Float32Array>;

export const generateVoiceover: VoiceoverGenerator = (request, signal, progress) => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
  const worker = new Worker(new URL('../workers/voiceover.worker.ts', import.meta.url), { type: 'module' });
  const finish = () => { worker.terminate(); signal.removeEventListener('abort', abort); };
  const abort = () => { finish(); reject(new DOMException('Cancelled', 'AbortError')); };
  signal.addEventListener('abort', abort, { once: true });
  worker.onerror = () => { finish(); reject(new Error('The local speech engine could not start. Try a supported desktop browser or the FrameCut macOS app.')); };
  worker.onmessage = (event: MessageEvent<{ type: string; message?: string; samples?: Float32Array }>) => {
    if (event.data.type === 'progress') progress(event.data.message ?? 'Generating voiceover…');
    else if (event.data.type === 'done' && event.data.samples) { finish(); resolve(event.data.samples); }
    else { finish(); reject(new Error(event.data.message ?? 'Voiceover generation failed.')); }
  };
  worker.postMessage(request);
});

// Injectable only through the existing opt-in E2E surface.
let generator: VoiceoverGenerator = generateVoiceover;
export const getVoiceoverGenerator = () => generator;
export const setVoiceoverGenerator = (next: VoiceoverGenerator) => { generator = next; };
