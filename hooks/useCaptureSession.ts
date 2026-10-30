import { useCallback, useMemo, useRef } from 'react';
import { CaptureClock, createCaptureClock } from '../utils/captureClock';
import { RecorderKind, blobTypeFor, pickRecorderMimeType } from '../utils/recorderMime';

/**
 * #28 PR-A: owns the MediaRecorders of one capture session on a common clock.
 * Today only the screen source is used; mic and camera are added as further sources in later PRs.
 * Each recorder's start offset (its `start` event, in session seconds) is recorded so sources can be
 * aligned on the timeline instead of assuming they all began at the same instant.
 */
export interface CaptureSourceSpec {
  id: string;            // e.g. 'screen' | 'mic' | 'camera'
  kind: RecorderKind;
  stream: MediaStream;
}

export interface CapturedSource {
  id: string;
  kind: RecorderKind;
  blob: Blob;
  mimeType: string;
  /** Session seconds at which `recorder.start()` was called for this source. */
  requestedOffset: number;
  /**
   * Session seconds of this recorder's `start` event. Chrome fires it once the first media
   * arrives, so it can lag `requestedOffset` (≈50–100 ms with real devices) or even land at stop
   * time for a source that never produced data. Used to measure skew between sources; it is NOT
   * used to re-base editor events (see useScreenRecorder).
   */
  startOffset: number;
  /** Session seconds at which the recorder stopped. */
  stopOffset: number;
}

export interface CaptureSessionResult {
  clock: CaptureClock;
  sources: CapturedSource[];
}

interface ActiveRecorder {
  spec: CaptureSourceSpec;
  recorder: MediaRecorder;
  chunks: Blob[];
  requestedMime: string;
  requestedOffset: number;
  startOffset: number | null;
  /** recorder.start() returned without throwing. A recorder that never started never fires onstop. */
  started: boolean;
  done: Promise<CapturedSource>;
  finish: () => void;
}

const stopTracks = (specs: CaptureSourceSpec[]) => {
  for (const s of specs) s.stream.getTracks().forEach(t => { try { t.stop(); } catch { /* ignore */ } });
};

/** Upper bound for a recorder's onstop after stop(); keeps Stop from hanging on an engine bug. */
const STOP_TIMEOUT_MS = 4000;

export const useCaptureSession = () => {
  const clockRef = useRef<CaptureClock | null>(null);
  const activeRef = useRef<ActiveRecorder[]>([]);

  /**
   * Start all recorders in the same task, on a fresh clock. If any recorder fails to construct or
   * start, everything is torn down (started recorders stopped, every track of every source stopped,
   * session cleared) and the error is rethrown, so a failed start never leaves a live capture behind.
   */
  const start = useCallback((specs: CaptureSourceSpec[]): CaptureClock => {
    const clock = createCaptureClock();
    const active: ActiveRecorder[] = [];
    try {
      for (const spec of specs) {
        const requestedMime = pickRecorderMimeType(spec.kind);
        const recorder = requestedMime ? new MediaRecorder(spec.stream, { mimeType: requestedMime }) : new MediaRecorder(spec.stream);
        const entry = { spec, recorder, chunks: [] as Blob[], requestedMime, requestedOffset: 0, startOffset: null as number | null, started: false } as ActiveRecorder;
        entry.done = new Promise<CapturedSource>((resolve) => {
          let settled = false;
          entry.finish = () => {
            if (settled) return;
            settled = true;
            const stopOffset = clock.now();
            const mimeType = blobTypeFor(spec.kind, recorder.mimeType, requestedMime);
            resolve({
              id: spec.id,
              kind: spec.kind,
              blob: new Blob(entry.chunks, { type: mimeType }),
              mimeType,
              requestedOffset: entry.requestedOffset,
              startOffset: entry.startOffset ?? entry.requestedOffset,
              stopOffset,
            });
          };
          recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) entry.chunks.push(e.data); };
          recorder.onstart = () => { entry.startOffset = clock.now(); };
          recorder.onstop = () => entry.finish();
          recorder.onerror = () => { if (recorder.state === 'inactive') entry.finish(); };
        });
        active.push(entry);
      }
      for (const a of active) {
        a.requestedOffset = clock.now();
        a.recorder.start();
        a.started = true;
      }
    } catch (e) {
      for (const a of active) {
        if (a.started && a.recorder.state !== 'inactive') { try { a.recorder.stop(); } catch { /* ignore */ } }
        a.finish();
      }
      stopTracks(specs);
      throw e;
    }
    clockRef.current = clock;
    activeRef.current = active;
    return clock;
  }, []);

  /** Stop every recorder that's still running and resolve once all have flushed. */
  const stop = useCallback(async (): Promise<CaptureSessionResult | null> => {
    const clock = clockRef.current;
    const active = activeRef.current;
    if (!clock || active.length === 0) return null;
    // Claim the session first so a concurrent stop() (Stop button + track `ended`) gets null.
    activeRef.current = [];
    clockRef.current = null;
    for (const a of active) {
      if (a.recorder.state !== 'inactive') {
        try { a.recorder.stop(); } catch { a.finish(); }
      } else if (!a.started) {
        a.finish(); // never started: no onstop will come
      }
    }
    // A recorder whose onstop never arrives must not hang Stop forever.
    const timer = setTimeout(() => active.forEach(a => a.finish()), STOP_TIMEOUT_MS);
    try {
      const sources = await Promise.all(active.map(a => a.done));
      return { clock, sources };
    } finally {
      clearTimeout(timer);
      stopTracks(active.map(a => a.spec));
    }
  }, []);

  /**
   * Stop one source (e.g. a disconnected microphone) while the others keep recording.
   * Its data so far is kept and returned with the rest by stop().
   */
  const stopSource = useCallback((id: string) => {
    const entry = activeRef.current.find(a => a.spec.id === id);
    if (!entry) return;
    if (entry.recorder.state !== 'inactive') { try { entry.recorder.stop(); } catch { entry.finish(); } }
    else entry.finish();
    entry.spec.stream.getTracks().forEach(t => { try { t.stop(); } catch { /* ignore */ } });
  }, []);

  /** Session seconds since start (0 when idle). */
  const now = useCallback(() => clockRef.current?.now() ?? 0, []);

  /** Start offset of a source once its recorder has fired `start` (null before that). */
  const startOffsetOf = useCallback((id: string) => activeRef.current.find(a => a.spec.id === id)?.startOffset ?? null, []);

  const isActive = useCallback(() => activeRef.current.some(a => a.recorder.state !== 'inactive'), []);

  return useMemo(() => ({ start, stop, stopSource, now, startOffsetOf, isActive }), [start, stop, stopSource, now, startOffsetOf, isActive]);
};
