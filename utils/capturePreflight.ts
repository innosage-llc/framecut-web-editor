import { createMonoMicStream, MonoMic, abandonPendingWarmup } from './monoMic';
import { dryRunRecorders } from './recorderWarmup';

/**
 * #28: warm the capture pipeline before the user presses Record, so the first capture in a page
 * starts like any later one. In a fresh renderer the first screen + narration recorders start
 * unevenly (cold first sessions drifted 25–90 ms); running the mono mic path and one throwaway
 * video + audio recorder pair once makes that cost here instead of after Record.
 *
 * Runs once per page, right after microphone permission is granted (the mic picker), on clones of
 * the preview stream and a small canvas video (the screen isn't shared yet). Output is discarded:
 * no blobs are kept, nothing is stored, no editor state changes. cancel() stops and releases every
 * track it opened. Failures are logged and never block recording.
 */
export type PreflightState = 'idle' | 'running' | 'done' | 'failed' | 'cancelled';

let state: PreflightState = 'idle';
let current: { abort: AbortController; tracks: MediaStreamTrack[] } | null = null;

const expose = () => {
  if ((window as any).__FRAMECUT_E2E_ENABLED__) (window as any).__FRAMECUT_PREFLIGHT__ = { state, tracks: current?.tracks ?? (window as any).__FRAMECUT_PREFLIGHT__?.tracks ?? [] };
};

export const preflightState = () => state;

const canvasVideo = (): { stream: MediaStream; stop: () => void } => {
  const c = document.createElement('canvas');
  c.width = 320; c.height = 180;
  const g = c.getContext('2d')!;
  let raf = 0, n = 0;
  const draw = () => { g.fillStyle = n++ % 2 ? '#222' : '#333'; g.fillRect(0, 0, 320, 180); raf = requestAnimationFrame(draw); };
  draw();
  const stream = c.captureStream(30);
  return { stream, stop: () => { cancelAnimationFrame(raf); stream.getTracks().forEach(t => t.stop()); } };
};

export const runCapturePreflight = async (micStream: MediaStream): Promise<void> => {
  if (state === 'running' || state === 'done') return;
  state = 'running';
  const abort = new AbortController();
  const tracks: MediaStreamTrack[] = [];
  current = { abort, tracks };
  expose();
  let mono: MonoMic | null = null;
  let video: { stream: MediaStream; stop: () => void } | null = null;
  try {
    const input = micStream.clone();
    tracks.push(...input.getTracks());
    mono = createMonoMicStream(input);
    if (!mono) throw new Error('Web Audio unavailable');
    tracks.push(...mono.stream.getTracks());
    await mono.ready;
    if (abort.signal.aborted) return;
    video = canvasVideo();
    tracks.push(...video.stream.getTracks());
    await dryRunRecorders([{ stream: video.stream, kind: 'video' }, { stream: mono.stream, kind: 'audio' }], 3000, abort.signal);
    if (!abort.signal.aborted) state = 'done';
  } catch (e) {
    console.warn('Capture preflight failed; recording will start normally.', e);
    if (state === 'running') state = 'failed';
  } finally {
    video?.stop();
    mono?.close(); // stops the cloned input too
    tracks.forEach(t => { try { t.stop(); } catch { /* ignore */ } });
    if (current?.abort === abort) current = null;
    (window as any).__FRAMECUT_E2E_ENABLED__ && ((window as any).__FRAMECUT_PREFLIGHT__ = { state, tracks });
  }
};

/** Stop a running preflight and release its tracks (mic deselected, page leaving, Record pressed). */
export const cancelCapturePreflight = () => {
  if (state !== 'running' || !current) return;
  state = 'cancelled';
  current.abort.abort();
  abandonPendingWarmup();
  current.tracks.forEach(t => { try { t.stop(); } catch { /* ignore */ } });
  expose();
};

/** Test seam: forget that the page already ran its preflight. */
export const resetCapturePreflight = () => { cancelCapturePreflight(); state = 'idle'; current = null; };
