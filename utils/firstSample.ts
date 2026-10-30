/**
 * #28: capture-time probes. Chromium stamps every AudioData from MediaStreamTrackProcessor with its
 * capture time on one monotonic clock (a constant offset from performance.now()). A probe reads a clone
 * of a track so the first sample delivered at or after a recorder's start() can be found, on the
 * performance.now() clock. Audio only: samples arrive every 10 ms, so there is no frame ambiguity.
 */
interface Sample { cap: number; now: number }
export interface TrackProbe { ready: Promise<boolean>; firstAfter: (perfMs: number) => number | null; stop: () => void }
export interface ProbeSet { probes: TrackProbe[]; ready: Promise<boolean>; stop: () => void }

export const createProbeSet = (tracks: MediaStreamTrack[], timeoutMs = 2000): ProbeSet | null => {
  const MSTP = (window as any).MediaStreamTrackProcessor;
  if (!MSTP || tracks.some(t => !t)) return null;
  let K = -Infinity; // shared: capture-clock ms − performance.now() ms (least-delayed delivery)
  const probes = tracks.map((track): TrackProbe => {
    const clone = track.clone();
    const samples: Sample[] = [];
    let stopped = false;
    let reader: ReadableStreamDefaultReader<any> | null = null;
    const ready = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      try { reader = new MSTP({ track: clone }).readable.getReader(); } catch { clearTimeout(timer); resolve(false); return; }
      (async () => {
        try {
          while (!stopped) {
            const { value, done } = await reader!.read();
            if (done) break;
            const now = performance.now();
            const cap = value.timestamp / 1000;
            value.close();
            K = Math.max(K, cap - now);
            samples.push({ cap, now });
            if (samples.length > 800) samples.splice(0, samples.length - 800);
            if (samples.length === 1) { clearTimeout(timer); resolve(true); }
          }
        } catch { /* ended */ }
      })();
    });
    return {
      ready,
      firstAfter: (perfMs) => {
        if (!samples.length || !Number.isFinite(K)) return null;
        const lat = samples.map(s => s.now - (s.cap - K)).sort((a, b) => a - b);
        const typical = lat[Math.floor(lat.length / 4)];
        const s = samples.find(s => s.cap - K + typical >= perfMs);
        return s ? s.cap - K : null;
      },
      stop: () => { stopped = true; try { reader?.cancel(); } catch { /* ignore */ } clone.stop(); },
    };
  });
  return { probes, ready: Promise.all(probes.map(p => p.ready)).then(r => r.every(Boolean)), stop: () => probes.forEach(p => p.stop()) };
};
