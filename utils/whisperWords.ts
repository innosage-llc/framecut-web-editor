/** #27 Pure helper shared by the Whisper worker and the main thread (no DOM / worker imports). */
import type { TranscriptSegment } from './transcriber';

/** Subtitle-sized grouping of Whisper word timings. */
export const CUE_MAX_SECONDS = 7;
export const CUE_MAX_CHARS = 84;
export const CUE_MAX_GAP_SECONDS = 0.8;

/**
 * Group word timings (transformers.js `return_timestamps: 'word'`) into cues: break after
 * sentence-ending punctuation, at a pause, or when a cue gets too long. Each segment keeps its
 * words so later trimming can cut the text to match. Words with a missing/backwards end get a
 * zero-length end at their start; words are ordered by start time.
 */
export function groupWordsIntoSegments(raw: { text: string; timestamp?: [number | null, number | null] }[], duration: number): TranscriptSegment[] {
  const words = (raw || [])
    .map(w => {
      const a = Number(w?.timestamp?.[0]); const b = Number(w?.timestamp?.[1]);
      if (!Number.isFinite(a) || typeof w?.text !== 'string' || w.text.trim() === '') return null;
      const start = Math.max(0, Math.min(duration, a));
      const end = Number.isFinite(b) && b >= start ? Math.min(duration, b) : start;
      return { text: w.text, start, end };
    })
    .filter((w): w is { text: string; start: number; end: number } => !!w)
    .sort((x, y) => x.start - y.start);
  const segs: TranscriptSegment[] = [];
  let cur: { text: string; start: number; end: number }[] = [];
  const flush = () => {
    if (!cur.length) return;
    const text = cur.map(w => w.text).join('').replace(/\s+/g, ' ').trim();
    if (text) segs.push({ start: cur[0].start, end: Math.max(cur[cur.length - 1].end, cur[0].start), text, words: cur });
    cur = [];
  };
  for (const w of words) {
    if (cur.length) {
      const last = cur[cur.length - 1];
      const len = cur.map(x => x.text).join('').trim().length + w.text.length;
      if (w.start - last.end > CUE_MAX_GAP_SECONDS || w.end - cur[0].start > CUE_MAX_SECONDS || len > CUE_MAX_CHARS) flush();
    }
    cur.push(w);
    if (/[.!?。！？]["')\]]*$/.test(w.text.trim())) flush();
  }
  flush();
  return segs;
}
