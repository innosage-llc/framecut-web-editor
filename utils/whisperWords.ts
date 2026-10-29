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
  let best = -1, bestScore = 0.05 + 1e-6; // ignore jitter-sized "pauses"
  for (let i = 0; i < ws.length - 1; i++) { const sc = pauseAfter(ws, i); if (sc > bestScore) { bestScore = sc; best = i; } }
  return best >= 0 ? best + 1 : Math.max(1, Math.floor(ws.length / 2));
}

const fits = (ws: Word[], i: number, j: number) =>
  j - i <= 1 || (ws[j - 1].end - ws[i].start <= CUE_MAX_SECONDS && textOf(ws.slice(i, j)).length <= CUE_MAX_CHARS);

/**
 * Split a run that is over the 7 s / 84-char cap into the fewest cues that fit, balanced in
 * length, preferring breaks at clause marks and real pauses (word-gap timing). Dynamic
 * programming over break positions, so no piece is left as a tiny tail.
 */
export function splitBalanced(ws: Word[]): Word[][] {
  const n = ws.length;
  if (n === 0) return [];
  if (fits(ws, 0, n)) return [ws];
  const totalChars = textOf(ws).length;
  const totalDur = ws[n - 1].end - ws[0].start;
  const k = Math.max(2, Math.ceil(totalDur / CUE_MAX_SECONDS), Math.ceil(totalChars / CUE_MAX_CHARS));
  const target = totalChars / k;
  const bonus = (j: number) => { // break after word j-1
    const t = ws[j - 1].text.trim();
    return (CLAUSE_END.test(t) || SENTENCE_END.test(t) ? 1.5 : 0) + Math.min(0.8, pauseAfter(ws, j - 1)) * 2;
  };
  const best: number[] = new Array(n + 1).fill(Infinity); const from: number[] = new Array(n + 1).fill(-1);
  best[0] = 0;
  for (let j = 1; j <= n; j++) {
    for (let i = j - 1; i >= 0; i--) {
      if (!fits(ws, i, j)) break; // longer pieces won't fit either
      if (best[i] === Infinity) continue;
      const len = textOf(ws.slice(i, j)).length;
      const c = best[i] + 10 + 4 * ((len - target) / target) ** 2 - (j < n ? bonus(j) : 0);
      if (c < best[j]) { best[j] = c; from[j] = i; }
    }
  }
  const pieces: Word[][] = [];
  for (let j = n; j > 0; j = from[j]) pieces.unshift(ws.slice(from[j], j));
  return pieces;
}

/** A fragment this small (and under a second) is merged into a neighbour across a clause mark. */
export const FRAGMENT_MAX_CHARS = 12;
export const FRAGMENT_MAX_SECONDS = 1;

/**
 * Group word timings (transformers.js `return_timestamps: 'word'`) into cues at natural
 * boundaries: a sentence end always breaks; a clause end (comma etc.) breaks once the cue is
 * long enough to stand alone; a pause > CUE_MAX_GAP_SECONDS breaks. A run that is still over
 * ~7 s / 84 characters is split evenly at its best pauses (splitBalanced). Finally a tiny
 * fragment left after a clause break is merged back into its neighbour when that fits and no
 * sentence end or long pause separates them.
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
  const groups: Word[][] = [];
  let cur: Word[] = [];
  const close = () => { if (cur.length) groups.push(...splitBalanced(cur)); cur = []; };
  for (const w of words) {
    if (cur.length && w.start - cur[cur.length - 1].end > CUE_MAX_GAP_SECONDS) close();
    cur.push(w);
    const t = w.text.trim();
    const dur = w.end - cur[0].start;
    if (SENTENCE_END.test(t) || (CLAUSE_END.test(t) && (dur >= CLAUSE_MIN_SECONDS || textOf(cur).length >= CLAUSE_MIN_CHARS))) close();
  }
  close();

  // Merge tiny fragments into a neighbour across a clause mark (never across a sentence end or a pause).
  const tiny = (g: Word[]) => textOf(g).length <= FRAGMENT_MAX_CHARS && g[g.length - 1].end - g[0].start < FRAGMENT_MAX_SECONDS;
  const joinable = (a: Word[], b: Word[]) =>
    !SENTENCE_END.test(a[a.length - 1].text.trim()) && b[0].start - a[a.length - 1].end <= CUE_MAX_GAP_SECONDS && fits([...a, ...b], 0, a.length + b.length);
  for (let i = 0; i < groups.length; i++) {
    if (groups.length < 2 || !tiny(groups[i])) continue;
    if (i > 0 && joinable(groups[i - 1], groups[i])) { groups[i - 1] = [...groups[i - 1], ...groups[i]]; groups.splice(i, 1); i -= 1; continue; }
    if (i + 1 < groups.length && joinable(groups[i], groups[i + 1])) { groups[i] = [...groups[i], ...groups[i + 1]]; groups.splice(i + 1, 1); i -= 1; }
  }

  return groups.map(ws => ({ start: ws[0].start, end: Math.max(ws[ws.length - 1].end, ws[0].start), text: textOf(ws), words: ws }))
    .filter(sg => sg.text !== '');
}
