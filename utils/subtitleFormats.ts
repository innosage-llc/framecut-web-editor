/**
 * #27 SRT / WebVTT import + export for subtitle cues.
 * Round-trip of start/end (millisecond precision) and multi-line text is lossless.
 * Styling/position are not representable in SRT/VTT and are not exported.
 */
export interface SubtitleCue { start: number; end: number; text: string; /** word timings from the engine; never stored on a Subtitle */ words?: { start: number; end: number; text: string }[]; }

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function formatCueTime(seconds: number, sep: ',' | '.'): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const s = Math.floor(totalMs / 1000) % 60;
  const m = Math.floor(totalMs / 60000) % 60;
  const h = Math.floor(totalMs / 3600000);
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms, 3)}`;
}

/** Accepts hh:mm:ss,mmm / hh:mm:ss.mmm / mm:ss.mmm (VTT short form). */
export function parseCueTime(raw: string): number | null {
  const m = raw.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const ms = m[4] ? parseInt(m[4].padEnd(3, '0'), 10) : 0;
  return (h * 3600000 + parseInt(m[2], 10) * 60000 + parseInt(m[3], 10) * 1000 + ms) / 1000;
}

/** Blank lines would terminate a cue in both formats; collapse them so export stays parseable. */
const cueText = (t: string) => t.replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim() !== '').join('\n');

const sorted = (cues: SubtitleCue[]) => [...cues].sort((a, b) => a.start - b.start || a.end - b.end);

export function toSrt(cues: SubtitleCue[]): string {
  return sorted(cues).map((c, i) =>
    `${i + 1}\n${formatCueTime(c.start, ',')} --> ${formatCueTime(c.end, ',')}\n${cueText(c.text)}\n`
  ).join('\n');
}

const escVtt = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescVtt = (t: string) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, '\u00a0').replace(/&amp;/g, '&');

export function toVtt(cues: SubtitleCue[]): string {
  const body = sorted(cues).map(c =>
    `${formatCueTime(c.start, '.')} --> ${formatCueTime(c.end, '.')}\n${escVtt(cueText(c.text))}\n`
  ).join('\n');
  return `WEBVTT\n\n${body}`;
}

const TIMING = /^\s*(\S+)\s+-->\s+(\S+)/;

function parseBlocks(text: string, isVtt: boolean): SubtitleCue[] {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const cues: SubtitleCue[] = [];
  for (const block of src.split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((l, i, a) => !(i === a.length - 1 && l === ''));
    const ti = lines.findIndex(l => TIMING.test(l));
    if (ti < 0) continue; // header, NOTE, STYLE, REGION, or junk
    if (isVtt && /^(NOTE|STYLE|REGION)\b/.test(lines[0] || '')) continue;
    const m = lines[ti].match(TIMING)!;
    const start = parseCueTime(m[1]);
    const end = parseCueTime(m[2]);
    if (start === null || end === null || end <= start) continue;
    let body = lines.slice(ti + 1).join('\n');
    if (isVtt) body = unescVtt(body);
    if (!body.trim()) continue;
    cues.push({ start, end, text: body });
  }
  return cues;
}

export const parseSrt = (text: string) => parseBlocks(text, false);
export const parseVtt = (text: string) => parseBlocks(text, true);

/** Detect format by header / file name; throws a user-facing error if nothing parses. */
export function parseSubtitleFile(text: string, fileName = ''): SubtitleCue[] {
  const isVtt = /^\uFEFF?WEBVTT/.test(text) || /\.vtt$/i.test(fileName);
  const cues = isVtt ? parseVtt(text) : parseSrt(text);
  if (cues.length === 0) throw new Error('No subtitle cues found. Use an .srt or .vtt file.');
  return cues;
}
