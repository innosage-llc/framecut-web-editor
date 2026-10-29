/**
 * #27 Swappable speech-to-text interface.
 *
 * The web editor ships NO speech-to-text engine yet: provider, cost, languages and model
 * download are open questions for Jingtian. The default transcriber is therefore
 * "unavailable" — it makes no network calls and downloads nothing. A real engine (or a
 * test mock) plugs in via setTranscriber(), optionally running in a Web Worker through
 * createWorkerTranscriber().
 */
export interface TranscriptSegment { start: number; end: number; text: string; }

export interface TranscribeRequest {
  /** Source media for the main video (blob: or same-origin URL). */
  mediaSrc: string;
  /** Media duration in seconds. */
  duration: number;
  language?: string;
}

export interface Transcriber {
  readonly id: string;
  /** Synchronous availability check; `reason` is user-facing copy when unavailable. */
  availability(): { available: true } | { available: false; reason: string };
  transcribe(req: TranscribeRequest, signal: AbortSignal): Promise<TranscriptSegment[]>;
}

export const TRANSCRIBER_UNAVAILABLE_COPY =
  "Automatic subtitles aren't available in the web editor yet. Import an .srt or .vtt file, type them on the subtitle track, or use the FrameCut macOS app.";

export const unavailableTranscriber: Transcriber = {
  id: 'unavailable',
  availability: () => ({ available: false, reason: TRANSCRIBER_UNAVAILABLE_COPY }),
  transcribe: async () => { throw new Error(TRANSCRIBER_UNAVAILABLE_COPY); },
};

let current: Transcriber = unavailableTranscriber;
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
  | { type: 'progress'; id: number; progress: number }
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
    transcribe(request, signal) {
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
          if (m.type === 'progress') opts.onProgress?.(m.progress);
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
