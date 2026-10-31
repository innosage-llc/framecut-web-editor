/**
 * #28: route the microphone through Web Audio so narration is recorded as mono at 48 kHz,
 * matching the macOS app. getUserMedia's channelCount/sampleRate are only hints (Chromium
 * captured stereo at 44.1 kHz in testing), so we downmix and resample ourselves.
 */
export interface MonoMic {
  stream: MediaStream;
  /** Resolves once the graph is rendering (samples flow into `stream`). */
  ready: Promise<void>;
  /** True once `ready` saw samples flowing out of the graph (so a recorder started now begins at start()). */
  flowing: () => boolean;
  sampleRate: number;
  channelCount: number;
  close: () => void;
  /**
   * True when this graph was built in a cold renderer (the one-off encoder warm-up below took longer
   * than COLD_WARMUP_MS). Such a graph was seen to carry 70–80 ms more input latency than normal for
   * the rest of its life (narration landed that much late), so callers rebuild it once: see release().
   */
  coldStart: () => boolean;
  /** Tear the graph down but leave the input tracks running (for a rebuild). */
  release: () => void;
}

export const COLD_WARMUP_MS = 250;

let warmed: Promise<void> | null = null;
let warmPending = false;
/** Running warm-ups, by the stream they recorded: each entry stops its recorder and its clone. */
const warmups = new Map<MediaStream, () => void>();
/** Stop the warm-up recording `stream`, if any (track.stop() fires no 'ended', so it must be explicit). */
const stopWarmupOf = (stream: MediaStream) => warmups.get(stream)?.();
/** Forget a warm-up that was abandoned before it finished, stopping its recorder and clone now. */
export const abandonPendingWarmup = () => {
  [...warmups.values()].forEach(done => done());
  if (warmPending) { warmed = null; warmPending = false; }
};
const warmUpAudioRecorder = (stream: MediaStream, force = false): Promise<void> => {
  if (warmed && !force) return warmed;
  warmPending = true;
  const p: Promise<void> = new Promise<void>((resolve) => {
    let rec: MediaRecorder;
    try {
      const type = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
      rec = type ? new MediaRecorder(stream.clone(), { mimeType: type }) : new MediaRecorder(stream.clone());
    } catch { resolve(); return; }
    const done = () => { clearTimeout(timer); warmups.delete(stream); try { if (rec.state !== 'inactive') rec.stop(); } catch { /* ignore */ } rec.stream.getTracks().forEach(t => t.stop()); resolve(); };
    warmups.set(stream, done);
    const timer = setTimeout(done, 3000);
    rec.onstart = done;
    // A source ended by the device must not hold anyone up (a local stop() goes through stopWarmupOf).
    stream.getTracks().forEach(t => t.addEventListener('ended', done, { once: true }));
    try { rec.start(); } catch { done(); }
  });
  warmed = p.finally(() => { if (warmed === guarded) warmPending = false; });
  const guarded = warmed;
  return warmed;
};

export const createMonoMicStream = (input: MediaStream, opts: { rewarm?: boolean } = {}): MonoMic | null => {
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
  let flowed = false;
  let cold = false;
  const ready = (async () => {
    try { await ctx.resume?.(); } catch { /* ignore */ }
    // Wait until mono samples actually flow out of the graph, so the narration recorder's media
    // time 0 is when start() is called (a cold device/context can otherwise begin hundreds of ms
    // late). Uses the track's delivered-frame counter where supported, else the context clock.
    const out = dest.stream.getAudioTracks()[0] as MediaStreamTrack & { stats?: { deliveredFrames?: number } };
    const flowing = () => (out?.stats && typeof out.stats.deliveredFrames === 'number' ? out.stats.deliveredFrames > 0 : ctx.currentTime > 0);
    const t = performance.now();
    while (!flowing() && performance.now() - t < 3000) await new Promise(r => setTimeout(r, 5));
    flowed = flowing();
    // The first audio MediaRecorder in a page can take over a second to initialise its encoder and
    // drops the samples captured meanwhile, so narration would start late. Warm it up once here.
    const first = !warmed;
    const w0 = performance.now();
    await warmUpAudioRecorder(dest.stream, !!opts.rewarm);
    cold = !opts.rewarm && first && performance.now() - w0 > COLD_WARMUP_MS;
  })();
  // Keep the graph referenced for the life of the recording (avoids GC of the source node).
  const keep = { source, dest };
  return {
    stream: dest.stream,
    ready,
    flowing: () => flowed,
    sampleRate: ctx.sampleRate,
    channelCount: dest.channelCount,
    coldStart: () => cold,
    release: () => {
      void keep;
      stopWarmupOf(dest.stream);
      try { source.disconnect(); } catch { /* ignore */ }
      ctx.close().catch(() => {});
      dest.stream.getTracks().forEach(t => t.stop());
    },
    close: () => {
      void keep;
      stopWarmupOf(dest.stream);
      dest.stream.getTracks().forEach(t => t.stop());
      try { source.disconnect(); } catch { /* ignore */ }
      ctx.close().catch(() => {});
      input.getTracks().forEach(t => t.stop());
    },
  };
};
