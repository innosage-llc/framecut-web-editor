/** #27 Pure helper shared by the Whisper worker and the main thread (no DOM / worker imports). */
import type { TranscriptSegment } from './transcriber';

type Word = { text: string; start: number; end: number };

/** Subtitle-sized grouping of Whisper word timings. The caps are a fallback only. */
export const CUE_MAX_SECONDS = 7;
export const CUE_MAX_CHARS = 84;
/** A silence this long always ends a cue. */
export const CUE_MAX_GAP_SECONDS = 0.8;
/** A clause (comma, semicolon, colon, dash) ends a cue once the cue is at least this long. */
export const CLAUSE_MIN_SECONDS = 1.5;
export const CLAUSE_MIN_CHARS = 30;

const SENTENCE_END = /[.!?…。！？]["'”’)\]]*$/;
const CLAUSE_END = /[,;:，、；：—–]["'”’)\]]*$/;
const textOf = (ws: Word[]) => ws.map(w => w.text).join('').replace(/\s+/g, ' ').trim();

/**
 * How much a break after word i looks like a pause: the silence before the next word, plus
 * the part of the word's own duration that is unusually long (Whisper's word alignment folds
 * a short pause into the preceding word, e.g. "Americans" 2.30–3.76 in the JFK sample).
 */
const pauseAfter = (ws: Word[], i: number) => {
  const w = ws[i]; const next = ws[i + 1];
  const gap = next ? Math.max(0, next.start - w.end) : 0;
  const perChar = 0.09; // ~speech rate
  const stretch = Math.max(0, (w.end - w.start) - Math.max(0.3, w.text.trim().length * perChar));
  return gap + stretch;
};

/**
 * Where to break an over-long run of words (fallback only): after the last clause
 * punctuation if there is one, otherwise at the biggest pause, otherwise in the middle.
 * Returns the number of words for the first cue (1 … ws.length - 1).
 */
export function chooseFallbackBreak(ws: Word[]): number {
  for (let i = ws.length - 2; i >= 0; i--) if (CLAUSE_END.test(ws[i].text.trim()) || SENTENCE_END.test(ws[i].text.trim())) return i + 1;
  let best = -1, bestScore = 0.05; // ignore jitter-sized "pauses"
  for (let i = 0; i < ws.length - 1; i++) { const sc = pauseAfter(ws, i); if (sc > bestScore) { bestScore = sc; best = i; } }
  return best >= 0 ? best + 1 : Math.max(1, Math.floor(ws.length / 2));
}

/**
 * Group word timings (transformers.js `return_timestamps: 'word'`) into cues at natural
 * boundaries: a sentence end always breaks; a clause end (comma etc.) breaks once the cue is
 * long enough to stand alone; a pause > CUE_MAX_GAP_SECONDS breaks. Only when a single clause
 * runs past ~7 s / 84 characters is it split, at its best internal pause (chooseFallbackBreak).
 * Each segment keeps its words so later trimming can cut the text to match. Words with a
 * missing/backwards end get a zero-length end at their start; words are ordered by start time.
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
    .filter((w): w is Word => !!w)
    .sort((x, y) => x.start - y.start);
  const segs: TranscriptSegment[] = [];
  const emit = (ws: Word[]) => {
    const text = textOf(ws);
    if (text) segs.push({ start: ws[0].start, end: Math.max(ws[ws.length - 1].end, ws[0].start), text, words: ws });
  };
  const tooLong = (ws: Word[]) => ws.length > 1 && (ws[ws.length - 1].end - ws[0].start > CUE_MAX_SECONDS || textOf(ws).length > CUE_MAX_CHARS);
  let cur: Word[] = [];
  for (const w of words) {
    if (cur.length && w.start - cur[cur.length - 1].end > CUE_MAX_GAP_SECONDS) { emit(cur); cur = []; }
    cur.push(w);
    while (tooLong(cur)) { const k = chooseFallbackBreak(cur); emit(cur.slice(0, k)); cur = cur.slice(k); }
    const t = w.text.trim();
    const dur = w.end - cur[0].start;
    if (SENTENCE_END.test(t) || (CLAUSE_END.test(t) && (dur >= CLAUSE_MIN_SECONDS || textOf(cur).length >= CLAUSE_MIN_CHARS))) { emit(cur); cur = []; }
  }
  if (cur.length) emit(cur);
  return segs;
}
