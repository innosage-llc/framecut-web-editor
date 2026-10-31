/**
 * Minimal WebM/Matroska demuxer for the first video track: enough to feed WebCodecs VideoDecoder
 * from MediaRecorder output (live, unknown-size Segment/Cluster) and ordinary WebM files.
 * Master elements are always descended (never skipped), so unknown sizes need no special handling.
 */
export interface DemuxedVideo {
  codec: string;
  codedWidth: number;
  codedHeight: number;
  description?: Uint8Array;
  /** Chunks in file (decode) order; timestamps in microseconds. */
  chunks: { timestamp: number; key: boolean; data: Uint8Array }[];
}

const MASTER = new Set([0x18538067, 0x1f43b675, 0x1654ae6b, 0xae, 0x1549a966, 0xa0, 0xe0]);
const CODECS: Record<string, string> = { V_VP8: 'vp8', V_VP9: 'vp09.00.10.08', V_AV1: 'av01.0.04M.08' };

function readVint(b: Uint8Array, p: number, keepMarker: boolean): { v: number; n: number; unknown: boolean } | null {
  if (p >= b.length) return null;
  const first = b[p];
  let n = 1, mask = 0x80;
  while (n <= 8 && !(first & mask)) { n++; mask >>= 1; }
  if (n > 8 || p + n > b.length) return null;
  let v = keepMarker ? first : first & (mask - 1);
  let allOnes = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < n; i++) { v = v * 256 + b[p + i]; if (b[p + i] !== 0xff) allOnes = false; }
  return { v, n, unknown: allOnes };
}

const readUint = (b: Uint8Array, p: number, len: number) => { let v = 0; for (let i = 0; i < len; i++) v = v * 256 + b[p + i]; return v; };

export function demuxWebmVideo(buf: ArrayBuffer): DemuxedVideo | null {
  const b = new Uint8Array(buf);
  let timescaleNs = 1_000_000;
  let clusterTc = 0;
  const tracks: { num: number; type: number; codecId: string; priv?: Uint8Array; w: number; h: number }[] = [];
  let cur: (typeof tracks)[number] | null = null;
  const blocks: { track: number; tc: number; key: boolean; data: Uint8Array }[] = [];

  const block = (p: number, end: number, simple: boolean, keyHint: boolean) => {
    const tn = readVint(b, p, false); if (!tn) return;
    const rel = (b[p + tn.n] << 8) | b[p + tn.n + 1];
    const tc = rel & 0x8000 ? rel - 0x10000 : rel;
    const flags = b[p + tn.n + 2];
    if (flags & 0x06) return; // lacing is not used for video by MediaRecorder; skip if present
    blocks.push({ track: tn.v, tc: clusterTc + tc, key: simple ? !!(flags & 0x80) : keyHint, data: b.subarray(p + tn.n + 3, end) });
  };

  let p = 0;
  const groupStack: { end: number; hasRef: boolean; blockAt: number; blockEnd: number }[] = [];
  while (p < b.length) {
    while (groupStack.length && p >= groupStack[groupStack.length - 1].end) {
      const g = groupStack.pop()!;
      if (g.blockAt >= 0) block(g.blockAt, g.blockEnd, false, !g.hasRef);
    }
    const id = readVint(b, p, true); if (!id) break;
    const sz = readVint(b, p + id.n, false); if (!sz) break;
    const start = p + id.n + sz.n;
    const end = sz.unknown ? b.length : Math.min(b.length, start + sz.v);
    if (MASTER.has(id.v)) {
      if (id.v === 0xae) { cur = { num: 0, type: 0, codecId: '', w: 0, h: 0 }; tracks.push(cur); }
      if (id.v === 0xa0) groupStack.push({ end, hasRef: false, blockAt: -1, blockEnd: -1 });
      p = start;
      continue;
    }
    switch (id.v) {
      case 0x2ad7b1: timescaleNs = readUint(b, start, end - start); break;
      case 0xe7: clusterTc = readUint(b, start, end - start); break;
      case 0xd7: if (cur) cur.num = readUint(b, start, end - start); break;
      case 0x83: if (cur) cur.type = readUint(b, start, end - start); break;
      case 0x86: if (cur) cur.codecId = new TextDecoder().decode(b.subarray(start, end)); break;
      case 0x63a2: if (cur) cur.priv = b.slice(start, end); break;
      case 0xb0: if (cur) cur.w = readUint(b, start, end - start); break;
      case 0xba: if (cur) cur.h = readUint(b, start, end - start); break;
      case 0xa3: block(start, end, true, false); break;
      case 0xa1: if (groupStack.length) { const g = groupStack[groupStack.length - 1]; g.blockAt = start; g.blockEnd = end; } break;
      case 0xfb: if (groupStack.length) groupStack[groupStack.length - 1].hasRef = true; break;
    }
    p = end;
  }
  while (groupStack.length) { const g = groupStack.pop()!; if (g.blockAt >= 0) block(g.blockAt, g.blockEnd, false, !g.hasRef); }

  const video = tracks.find(t => t.type === 1 && CODECS[t.codecId]);
  if (!video) return null;
  const chunks = blocks
    .filter(x => x.track === video.num)
    .map(x => ({ timestamp: Math.round((x.tc * timescaleNs) / 1000), key: x.key, data: x.data }));
  if (!chunks.length || !chunks[0].key) return null;
  return {
    codec: CODECS[video.codecId],
    codedWidth: video.w,
    codedHeight: video.h,
    description: video.codecId === 'V_AV1' ? video.priv : undefined,
    chunks,
  };
}
