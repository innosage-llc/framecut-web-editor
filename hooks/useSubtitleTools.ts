import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ExtendedEditorState, Subtitle } from '../types';
import { getTranscriber, subscribeTranscriber } from '../utils/transcriber';
import { replaceAutoSubtitles, segmentsToCues, cueToSubtitle } from '../utils/subtitleGeneration';
import { parseSubtitleFile, toSrt, toVtt } from '../utils/subtitleFormats';

export type SubtitleToolStatus =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done' | 'imported' | 'empty' | 'error' | 'unavailable' | 'exported'; message: string };

export const GENERATION_TIMEOUT_MS = 15 * 60 * 1000;

interface Props {
  setState: React.Dispatch<React.SetStateAction<ExtendedEditorState>>;
  stateRef: React.MutableRefObject<ExtendedEditorState>;
  pushHistory: () => void;
  recalculateDuration: (...args: any[]) => number;
}

const withSubs = (prev: ExtendedEditorState, subtitles: Subtitle[], recalc: Props['recalculateDuration']): ExtendedEditorState => ({
  ...prev, subtitles,
  selection: prev.selection?.type === 'subtitle' && !subtitles.some(s => s.id === prev.selection!.id) ? null : prev.selection,
  duration: recalc(prev.clips, prev.audioClips, subtitles, prev.zoomEffects, prev.spotlightEffects, prev.mosaicEffects),
});

export function useSubtitleTools({ setState, stateRef, pushHistory, recalculateDuration }: Props) {
  const [status, setStatus] = useState<SubtitleToolStatus>({ kind: 'idle' });
  const [, force] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const timeoutMsRef = useRef(GENERATION_TIMEOUT_MS);

  useEffect(() => subscribeTranscriber(() => force(n => n + 1)), []);
  useEffect(() => () => abortRef.current?.abort(), []);

  const availability = getTranscriber().availability();

  const generate = useCallback(async () => {
    if (abortRef.current) return; // already running
    const transcriber = getTranscriber();
    const avail = transcriber.availability();
    if ('reason' in avail) { setStatus({ kind: 'unavailable', message: avail.reason }); return; }
    const s = stateRef.current;
    if (!s.mainVideo) { setStatus({ kind: 'error', message: 'Add a video before generating subtitles.' }); return; }

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStatus({ kind: 'running' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new Error('Subtitle generation timed out.')); ctrl.abort(); }, timeoutMsRef.current);
      });
      const segments = await Promise.race([
        transcriber.transcribe({ mediaSrc: s.mainVideo.src, duration: s.mainVideo.duration || s.duration }, ctrl.signal),
        timeout,
      ]);
      const cues = segmentsToCues(segments, stateRef.current.duration || s.duration);
      if (abortRef.current !== ctrl) return;
      if (cues.length === 0) {
        setStatus({ kind: 'empty', message: 'No speech found. Existing subtitles were left unchanged.' });
        return;
      }
      pushHistory();
      setState(prev => withSubs(prev, replaceAutoSubtitles(prev.subtitles, cues), recalculateDuration));
      setStatus({ kind: 'done', message: `Generated ${cues.length} subtitle${cues.length === 1 ? '' : 's'}. Manual subtitles were kept.` });
    } catch (err: any) {
      if (abortRef.current !== ctrl) return; // user cancelled; cancel() already reset status
      setStatus({ kind: 'error', message: `Couldn't generate subtitles: ${err?.message || 'unknown error'}` });
    } finally {
      if (timer) clearTimeout(timer);
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  }, [pushHistory, recalculateDuration, setState, stateRef]);

  const cancel = useCallback(() => {
    const c = abortRef.current;
    abortRef.current = null;
    c?.abort();
    setStatus({ kind: 'idle' });
  }, []);

  const importFile = useCallback(async (file: File) => {
    try {
      const cues = parseSubtitleFile(await file.text(), file.name);
      pushHistory();
      setState(prev => withSubs(prev, [...prev.subtitles, ...cues.map(c => cueToSubtitle(c, false))], recalculateDuration));
      setStatus({ kind: 'imported', message: `Imported ${cues.length} subtitle${cues.length === 1 ? '' : 's'} from ${file.name}.` });
    } catch (err: any) {
      setStatus({ kind: 'error', message: `Couldn't import ${file.name}: ${err?.message || 'unreadable file'}` });
    }
  }, [pushHistory, recalculateDuration, setState]);

  const exportFile = useCallback((format: 'srt' | 'vtt') => {
    const subs = stateRef.current.subtitles;
    if (subs.length === 0) { setStatus({ kind: 'error', message: 'There are no subtitles to export.' }); return; }
    const text = format === 'srt' ? toSrt(subs) : toVtt(subs);
    const base = (stateRef.current.fileName || 'subtitles').replace(/\.[^.]+$/, '');
    const url = URL.createObjectURL(new Blob([text], { type: format === 'srt' ? 'application/x-subrip' : 'text/vtt' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${base}.${format}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus({ kind: 'exported', message: `Exported ${subs.length} subtitle${subs.length === 1 ? '' : 's'} as .${format}.` });
  }, [stateRef]);

  const dismiss = useCallback(() => setStatus({ kind: 'idle' }), []);
  const setTimeoutMs = useCallback((ms: number) => { timeoutMsRef.current = ms; }, []);

  return { status, availability, generate, cancel, importFile, exportFile, dismiss, setTimeoutMs };
}
