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
  done: Promise<CapturedSource>;
}

export const useCaptureSession = () => {
  const clockRef = useRef<CaptureClock | null>(null);
  const activeRef = useRef<ActiveRecorder[]>([]);

  /** Start all recorders in the same task, on a fresh clock. Throws if any recorder fails to construct. */
  const start = useCallback((specs: CaptureSourceSpec[]): CaptureClock => {
    const clock = createCaptureClock();
    clockRef.current = clock;
    const active: ActiveRecorder[] = specs.map(spec => {
      const requestedMime = pickRecorderMimeType(spec.kind);
      const recorder = requestedMime ? new MediaRecorder(spec.stream, { mimeType: requestedMime }) : new MediaRecorder(spec.stream);
      const entry = { spec, recorder, chunks: [] as Blob[], requestedMime, requestedOffset: 0, startOffset: null as number | null } as ActiveRecorder;
      entry.done = new Promise<CapturedSource>((resolve) => {
        recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) entry.chunks.push(e.data); };
        recorder.onstart = () => { entry.startOffset = clock.now(); };
        recorder.onstop = () => {
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
      });
      return entry;
    });
    activeRef.current = active;
    for (const a of active) {
      a.requestedOffset = clock.now();
      a.recorder.start();
    }
    return clock;
  }, []);

  /** Stop every recorder that's still running and resolve once all have flushed. */
  const stop = useCallback(async (): Promise<CaptureSessionResult | null> => {
    const clock = clockRef.current;
    const active = activeRef.current;
    if (!clock || active.length === 0) return null;
    for (const a of active) {
      if (a.recorder.state !== 'inactive') a.recorder.stop();
    }
    const sources = await Promise.all(active.map(a => a.done));
    activeRef.current = [];
    for (const a of active) a.spec.stream.getTracks().forEach(t => t.stop());
    return { clock, sources };
  }, []);

  /**
   * Stop one source (e.g. a disconnected microphone) while the others keep recording.
   * Its data so far is kept and returned with the rest by stop().
   */
  const stopSource = useCallback((id: string) => {
    const entry = activeRef.current.find(a => a.spec.id === id);
    if (entry && entry.recorder.state !== 'inactive') entry.recorder.stop();
  }, []);

  /** Session seconds since start (0 when idle). */
  const now = useCallback(() => clockRef.current?.now() ?? 0, []);

  /** Start offset of a source once its recorder has fired `start` (null before that). */
  const startOffsetOf = useCallback((id: string) => activeRef.current.find(a => a.spec.id === id)?.startOffset ?? null, []);

  const isActive = useCallback(() => activeRef.current.some(a => a.recorder.state !== 'inactive'), []);

  return useMemo(() => ({ start, stop, stopSource, now, startOffsetOf, isActive }), [start, stop, stopSource, now, startOffsetOf, isActive]);
};
