import { pickRecorderMimeType } from './recorderMime';

export const DRY_RUN_TAIL_MS = 600;

/**
 * #28: in a renderer that has not recorded yet, the first screen + narration recorders run side by
 * side start unevenly (narration was seen 25–55 ms off under CPU load even with both encoders warmed
 * separately). When the mic path reports a cold start, one throwaway pair on clones of the same
 * streams, run until both have produced their first chunk and then for DRY_RUN_TAIL_MS more, takes
 * that cost before the real session (stopping at the first chunk was not enough: 3 of 10 cold
 * sessions still drifted; with the tail, 1 of 10 under full CPU load). Never throws; gives up after
 * `timeoutMs`.
 */
export const dryRunRecorders = (streams: { stream: MediaStream; kind: 'video' | 'audio' }[], timeoutMs = 3000, signal?: AbortSignal): Promise<void> =>
  new Promise<void>((resolve) => {
    const recs: MediaRecorder[] = [];
    const clones: MediaStream[] = [];
    let pending = streams.length;
    const done = () => {
      clearTimeout(timer);
      for (const r of recs) { try { if (r.state !== 'inactive') r.stop(); } catch { /* ignore */ } }
      clones.forEach(c => c.getTracks().forEach(t => t.stop()));
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    if (signal?.aborted) { done(); return; }
    signal?.addEventListener('abort', done, { once: true });
    try {
      if (typeof MediaRecorder === 'undefined') { done(); return; }
      for (const { stream, kind } of streams) {
        const clone = stream.clone();
        clones.push(clone);
        const type = pickRecorderMimeType(kind);
        const rec = type ? new MediaRecorder(clone, { mimeType: type }) : new MediaRecorder(clone);
        rec.onstart = () => { if (--pending <= 0) setTimeout(done, DRY_RUN_TAIL_MS); };
        rec.onerror = done;
        rec.ondataavailable = null; // output discarded
        recs.push(rec);
      }
      recs.forEach(r => r.start());
    } catch { done(); }
  });
