/**
 * #28: route the microphone through Web Audio so narration is recorded as mono at 48 kHz,
 * matching the macOS app. getUserMedia's channelCount/sampleRate are only hints (Chromium
 * captured stereo at 44.1 kHz in testing), so we downmix and resample ourselves.
 */
export interface MonoMic {
  stream: MediaStream;
  sampleRate: number;
  channelCount: number;
  close: () => void;
}

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
  ctx.resume?.().catch(() => {});
  // Keep the graph referenced for the life of the recording (avoids GC of the source node).
  const keep = { source, dest };
  return {
    stream: dest.stream,
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
