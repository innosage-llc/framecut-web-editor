/**
 * #28: route the microphone through Web Audio so narration is recorded as mono at 48 kHz,
 * matching the macOS app. getUserMedia's channelCount/sampleRate are only hints (Chromium
 * captured stereo at 44.1 kHz in testing), so we downmix and resample ourselves.
 */
export interface MonoMic {
  stream: MediaStream;
  /** Resolves once the graph is rendering (samples flow into `stream`). */
  ready: Promise<void>;
  sampleRate: number;
  channelCount: number;
  close: () => void;
}

let warmed: Promise<void> | null = null;
const warmUpAudioRecorder = (stream: MediaStream): Promise<void> => {
  if (warmed) return warmed;
  warmed = new Promise<void>((resolve) => {
    let rec: MediaRecorder;
    try {
      const type = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
      rec = type ? new MediaRecorder(stream.clone(), { mimeType: type }) : new MediaRecorder(stream.clone());
    } catch { resolve(); return; }
    const done = () => { clearTimeout(timer); try { if (rec.state !== 'inactive') rec.stop(); } catch { /* ignore */ } rec.stream.getTracks().forEach(t => t.stop()); resolve(); };
    const timer = setTimeout(done, 3000);
    rec.onstart = done;
    try { rec.start(); } catch { done(); }
  });
  return warmed;
};

export const createMonoMicStream = (input: MediaStream): MonoMic | null => {
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  if (!AC) return null;
  let ctx: AudioContext;
  try {
    ctx = new AC({ sampleRate: 48000, latencyHint: 'interactive' });
  } catch {
    try { ctx = new AC(); } catch { return null; }
  }
  const source = ctx.createMediaStreamSource(input);
  const dest = ctx.createMediaStreamDestination();
  dest.channelCount = 1;
  dest.channelCountMode = 'explicit';
  dest.channelInterpretation = 'speakers';
  source.connect(dest);
  const ready = (async () => {
    try { await ctx.resume?.(); } catch { /* ignore */ }
    // Wait until mono samples actually flow out of the graph, so the narration recorder's media
    // time 0 is when start() is called (a cold device/context can otherwise begin hundreds of ms
    // late). Uses the track's delivered-frame counter where supported, else the context clock.
    const out = dest.stream.getAudioTracks()[0] as MediaStreamTrack & { stats?: { deliveredFrames?: number } };
    const flowing = () => (out?.stats && typeof out.stats.deliveredFrames === 'number' ? out.stats.deliveredFrames > 0 : ctx.currentTime > 0);
    const t = performance.now();
    while (!flowing() && performance.now() - t < 3000) await new Promise(r => setTimeout(r, 5));
    // The first audio MediaRecorder in a page can take over a second to initialise its encoder and
    // drops the samples captured meanwhile, so narration would start late. Warm it up once here.
    await warmUpAudioRecorder(dest.stream);
  })();
  // Keep the graph referenced for the life of the recording (avoids GC of the source node).
  const keep = { source, dest };
  return {
    stream: dest.stream,
    ready,
    sampleRate: ctx.sampleRate,
    channelCount: dest.channelCount,
    close: () => {
      void keep;
      try { source.disconnect(); } catch { /* ignore */ }
      ctx.close().catch(() => {});
      input.getTracks().forEach(t => t.stop());
    },
  };
};
