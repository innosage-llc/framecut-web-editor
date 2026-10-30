/**
 * #28: Chromium's MediaRecorder starts a WebM's timeline at the first *video* frame, and when the
 * first audio packets of the session are dropped while the recorder spins up (a few ms at rest,
 * 20–35 ms under CPU load) the audio track begins later, at a non-zero timecode (the "audio lead").
 * Media elements honour that timecode but decodeAudioData (export, waveforms, analysis) does not, so
 * the same recording's audio sat at two different places depending on who read it, and narration
 * aligned to one was off from the other by the lead.
 *
 * rebaseWebmToAudioStart moves the timeline zero to the first audio packet: every block keeps its
 * A/V relationship, the (at most one or two) video frames before the audio start are pinned to 0.
 * Timecodes are rewritten in place (same byte widths), so the file layout is unchanged.
 */

const ID = { Segment: 0x18538067, Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7, TrackType: 0x83, Cluster: 0x1f43b675, Timecode: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1 };
const CONTAINERS = new Set([ID.Segment, ID.Info, ID.Tracks, ID.TrackEntry, ID.Cluster, ID.BlockGroup]);

/** Reads an EBML id (marker bits kept) or size (marker stripped); null at the end of data. */
const vint = (d: Uint8Array, p: number, keepMarker: boolean): { value: number; len: number; unknown: boolean } | null => {
  if (p >= d.length) return null;
  const first = d[p];
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || p + len > d.length) return null;
  let value = keepMarker ? first : first & (0xff >> len);
  let allOnes = value === (0xff >> len);
  for (let i = 1; i < len; i++) { value = value * 256 + d[p + i]; if (d[p + i] !== 0xff) allOnes = false; }
  return { value, len, unknown: !keepMarker && allOnes };
};

const readUint = (d: Uint8Array, p: number, n: number) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + d[p + i]; return v; };
const writeUint = (d: Uint8Array, p: number, n: number, v: number) => { for (let i = n - 1; i >= 0; i--) { d[p + i] = v % 256; v = Math.floor(v / 256); } };

interface BlockRef { trackPos: number; tcPos: number; track: number; cluster: ClusterRef }
interface ClusterRef { tcPos: number; tcLen: number; tc: number }

const scan = (d: Uint8Array) => {
  const tracks = new Map<number, number>(); // track number -> type
  const blocks: BlockRef[] = [];
  const clusters: ClusterRef[] = [];
  let scale = 1_000_000;
  let entry: { num?: number; type?: number } | null = null;
  let cluster: ClusterRef | null = null;
  const walk = (start: number, end: number, parent: number) => {
    let p = start;
    while (p < end) {
      const id = vint(d, p, true); if (!id) return;
      const size = vint(d, p + id.len, false); if (!size) return;
      const body = p + id.len + size.len;
      const bodyEnd = size.unknown ? end : Math.min(end, body + size.value);
      // Unknown-size clusters end where the next top-level element starts.
      if (id.value === ID.Cluster && parent === ID.Segment) { cluster = { tcPos: -1, tcLen: 0, tc: 0 }; clusters.push(cluster); }
      if (id.value === ID.TrackEntry) entry = {};
      if (CONTAINERS.has(id.value)) {
        if (size.unknown && id.value === ID.Cluster) { p = body; continue; } // children follow inline
        walk(body, bodyEnd, id.value);
        if (id.value === ID.TrackEntry && entry?.num !== undefined) tracks.set(entry.num, entry.type ?? 0);
      } else if (id.value === ID.TimecodeScale) scale = readUint(d, body, size.value);
      else if (id.value === ID.TrackNumber && entry) entry.num = readUint(d, body, size.value);
      else if (id.value === ID.TrackType && entry) entry.type = readUint(d, body, size.value);
      else if (id.value === ID.Timecode && cluster) { cluster.tcPos = body; cluster.tcLen = size.value; cluster.tc = readUint(d, body, size.value); }
      else if ((id.value === ID.SimpleBlock || id.value === ID.Block) && cluster) {
        const tn = vint(d, body, false);
        if (tn) blocks.push({ trackPos: body, tcPos: body + tn.len, track: tn.value, cluster });
      }
      if (size.unknown) return;
      p = bodyEnd;
    }
  };
  walk(0, d.length, 0);
  return { tracks, blocks, clusters, scale };
};

const rel = (d: Uint8Array, p: number) => { const v = (d[p] << 8) | d[p + 1]; return v >= 0x8000 ? v - 0x10000 : v; };

/** The audio lead in seconds (first audio block time minus first video block time), or 0. */
export const webmAudioLead = (bytes: Uint8Array): number => {
  try {
    const { tracks, blocks, scale } = scan(bytes);
    const first = (type: number) => { const b = blocks.find(b => tracks.get(b.track) === type); return b ? b.cluster.tc + rel(bytes, b.tcPos) : null; };
    const v = first(1), a = first(2);
    if (v === null || a === null) return 0;
    return ((a - v) * scale) / 1e9;
  } catch { return 0; }
};

/** Leads beyond this are not a dropped start; leave such files alone. */
const MAX_LEAD_S = 0.5;

export const rebaseWebmToAudioStart = async (blob: Blob): Promise<{ blob: Blob; lead: number }> => {
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const { tracks, blocks, clusters, scale } = scan(bytes);
    const first = (type: number) => { const b = blocks.find(b => tracks.get(b.track) === type); return b ? b.cluster.tc + rel(bytes, b.tcPos) : null; };
    const v = first(1), a = first(2);
    if (v === null || a === null || a <= v || ((a - v) * scale) / 1e9 > MAX_LEAD_S) return { blob, lead: 0 };
    if (clusters.some(c => c.tcPos < 0)) return { blob, lead: 0 };
    const shift = a - v;
    // Clusters at or after the shift move back by it; earlier ones keep their timecode and their
    // blocks move instead (never below 0).
    const moved = new Set<ClusterRef>();
    for (const c of clusters) if (c.tc >= shift) { writeUint(bytes, c.tcPos, c.tcLen, c.tc - shift); moved.add(c); }
    for (const b of blocks) {
      if (moved.has(b.cluster)) continue;
      const t = Math.max(-b.cluster.tc, rel(bytes, b.tcPos) - shift);
      const u = t < 0 ? t + 0x10000 : t;
      bytes[b.tcPos] = u >> 8; bytes[b.tcPos + 1] = u & 0xff;
    }
    return { blob: new Blob([bytes], { type: blob.type }), lead: (shift * scale) / 1e9 };
  } catch {
    return { blob, lead: 0 };
  }
};
