import { demuxWebmVideo, DemuxedVideo } from './webmDemux';

/**
 * #28: decodes the camera recording once (WebCodecs) and hands out the frame for a media time,
 * decoding forward from the nearest key frame. Used by realtime (MP4) export so the bubble never
 * depends on a second <video> element's playback clock. Frames are picked by timestamp: the frame
 * shown at media time t is the last one with timestamp <= t (same rule as the video element).
 */
export class CameraFrameSource {
  private decoder: VideoDecoder | null = null;
  private next = 0; // next chunk index to feed
  private current: { idx: number; frame: VideoFrame } | null = null;
  private pending = new Map<number, (f: VideoFrame | null) => void>();
  private broken = false;
  private constructor(private readonly v: DemuxedVideo, private readonly config: VideoDecoderConfig) {}

  static async create(blob: Blob): Promise<CameraFrameSource | null> {
    if (typeof VideoDecoder === 'undefined') return null;
    try {
      const v = demuxWebmVideo(await blob.arrayBuffer());
      if (!v) return null;
      const config: VideoDecoderConfig = { codec: v.codec, codedWidth: v.codedWidth, codedHeight: v.codedHeight, description: v.description };
      const support = await VideoDecoder.isConfigSupported(config);
      if (!support.supported) return null;
      return new CameraFrameSource(v, config);
    } catch {
      return null;
    }
  }

  private indexAt(timeS: number) {
    const us = timeS * 1e6 + 500; // half-microsecond tolerance on rounded timestamps
    const c = this.v.chunks;
    let lo = 0, hi = c.length - 1, ans = 0;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (c[m].timestamp <= us) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans;
  }

  private reset(fromIdx: number) {
    this.decoder?.close();
    for (const r of this.pending.values()) r(null);
    this.pending.clear();
    this.decoder = new VideoDecoder({
      output: (f) => {
        const r = this.pending.get(f.timestamp);
        if (r) { this.pending.delete(f.timestamp); r(f); } else f.close();
      },
      error: () => { this.broken = true; for (const r of this.pending.values()) r(null); this.pending.clear(); },
    });
    this.decoder.configure(this.config);
    let k = fromIdx;
    while (k > 0 && !this.v.chunks[k].key) k--;
    this.next = k;
  }

  /** Frame for media time `timeS` (seconds), or null if decoding is unavailable. Do not close it. */
  async frameAt(timeS: number): Promise<VideoFrame | null> {
    if (this.broken) return null;
    const idx = this.indexAt(timeS);
    if (this.current?.idx === idx) return this.current.frame;
    let keyBetween = false;
    for (let i = this.next; i <= idx && !keyBetween; i++) if (i > this.next && this.v.chunks[i].key) keyBetween = true;
    if (!this.decoder || idx < this.next || keyBetween && idx - this.next > 30) this.reset(idx);
    let frame: VideoFrame | null = null;
    while (this.next <= idx) {
      const i = this.next++;
      const c = this.v.chunks[i];
      const p = new Promise<VideoFrame | null>((res) => this.pending.set(c.timestamp, res));
      this.decoder!.decode(new EncodedVideoChunk({ type: c.key ? 'key' : 'delta', timestamp: c.timestamp, data: c.data }));
      if (i < idx) { p.then(f => f?.close()); continue; }
      const timeout = new Promise<'t'>((res) => setTimeout(() => res('t'), 1000));
      const out = await Promise.race([p, timeout]);
      if (out === 't') {
        // Decoder is holding output: flush (requires a key frame next, so restart from one after).
        try { await this.decoder!.flush(); } catch { /* error handler marks broken */ }
        frame = await Promise.race([p, Promise.resolve(null)]);
        this.decoder?.close(); this.decoder = null;
      } else frame = out;
    }
    if (!frame) return this.current?.frame ?? null;
    this.current?.frame.close();
    this.current = { idx, frame };
    return frame;
  }

  close() {
    this.current?.frame.close();
    this.current = null;
    this.decoder?.close();
    this.decoder = null;
    this.pending.clear();
  }
}

/**
 * Lets the canvas renderer (which reads videoWidth/videoHeight) draw a decoded VideoFrame.
 * drawImage accepts VideoFrame directly; only the size fields are added.
 */
export function asVideoSource(frame: VideoFrame): HTMLVideoElement {
  const f = frame as VideoFrame & { videoWidth?: number; videoHeight?: number };
  if (f.videoWidth === undefined) {
    Object.defineProperty(f, 'videoWidth', { value: frame.displayWidth });
    Object.defineProperty(f, 'videoHeight', { value: frame.displayHeight });
    Object.defineProperty(f, 'readyState', { value: 4 });
  }
  return f as unknown as HTMLVideoElement;
}
