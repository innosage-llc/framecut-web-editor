/**
 * #27 Swappable speech-to-text interface.
 *
 * Default engine: on-device Whisper tiny in a Web Worker (utils/whisperTranscriber.ts),
 * downloaded only after the user opts in. `unavailableTranscriber` is the fallback for
 * browsers without WebAssembly / Web Audio. Tests inject mocks via setTranscriber().
 */
export interface TranscriptSegment { start: number; end: number; text: string; }

export interface TranscribeRequest {
  /** Source media for the main video (blob: or same-origin URL). */
  mediaSrc: string;
  /** Media duration in seconds. */
  duration: number;
  language?: string;
  /** 16 kHz mono PCM, filled in by engines that decode audio on the main thread. */
  audio?: Float32Array;
}

export interface TranscribeProgress { phase: 'download' | 'transcribe'; progress: number; }

export interface Transcriber {
  readonly id: string;
  /** Present when the engine needs a one-time opt-in download before first use. */
  download?: { approxMB: number; source: string; isReady(): Promise<boolean> };
  /** Synchronous availability check; `reason` is user-facing copy when unavailable. */
  availability(): { available: true } | { available: false; reason: string };
  transcribe(req: TranscribeRequest, signal: AbortSignal, onProgress?: (p: TranscribeProgress) => void): Promise<TranscriptSegment[]>;
}

export const TRANSCRIBER_UNAVAILABLE_COPY =
  "Automatic subtitles aren't available in the web editor yet. Import an .srt or .vtt file, type them on the subtitle track, or use the FrameCut macOS app.";

export const unavailableTranscriber: Transcriber = {
  id: 'unavailable',
  availability: () => ({ available: false, reason: TRANSCRIBER_UNAVAILABLE_COPY }),
  transcribe: async () => { throw new Error(TRANSCRIBER_UNAVAILABLE_COPY); },
};

let current: Transcriber = unavailableTranscriber;
/** Called once at startup by the app to install the default engine. */
export const installDefaultTranscriber = (t: Transcriber) => { current = t; };
const listeners = new Set<() => void>();
export const getTranscriber = () => current;
export function setTranscriber(t: Transcriber | null) {
  current = t ?? unavailableTranscriber;
  listeners.forEach(l => l());
}
export function subscribeTranscriber(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

/**
 * Worker protocol (both directions are structured-cloned):
 *   main → worker: { type: 'transcribe', id, request }
 *   worker → main: { type: 'progress', id, progress } | { type: 'result', id, segments } | { type: 'error', id, message }
 */
export type TranscriberWorkerMessage =
  | { type: 'progress'; id: number; progress: number; phase?: 'download' | 'transcribe' }
  | { type: 'result'; id: number; segments: TranscriptSegment[] }
  | { type: 'error'; id: number; message: string };

export function createWorkerTranscriber(
  makeWorker: () => Worker,
  opts: { id?: string; onProgress?: (p: number) => void } = {}
): Transcriber {
  let seq = 0;
  return {
    id: opts.id ?? 'worker',
    availability: () => ({ available: true }),
    transcribe(request, signal, onProgress) {
      return new Promise<TranscriptSegment[]>((resolve, reject) => {
        if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
        const worker = makeWorker();
        const id = ++seq;
        const done = () => { worker.terminate(); signal.removeEventListener('abort', onAbort); };
        const onAbort = () => { done(); reject(new DOMException('Aborted', 'AbortError')); };
        signal.addEventListener('abort', onAbort);
        worker.onmessage = (e: MessageEvent<TranscriberWorkerMessage>) => {
          const m = e.data;
          if (!m || m.id !== id) return;
          if (m.type === 'progress') { opts.onProgress?.(m.progress); onProgress?.({ phase: m.phase ?? 'transcribe', progress: m.progress }); }
          else if (m.type === 'result') { done(); resolve(Array.isArray(m.segments) ? m.segments : []); }
          else if (m.type === 'error') { done(); reject(new Error(m.message || 'Transcription failed')); }
        };
        worker.onerror = (e) => { e.preventDefault?.(); done(); reject(new Error(e.message || 'Transcription worker crashed')); };
        worker.postMessage({ type: 'transcribe', id, request });
      });
    },
  };
}

/** Stub worker shipped with the app (no engine): see workers/transcriber.worker.ts. */
export const createStubWorker = () =>
  new Worker(new URL('../workers/transcriber.worker.ts', import.meta.url), { type: 'module' });
