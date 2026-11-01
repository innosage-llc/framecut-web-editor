import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ExtendedEditorState } from '../types';
import { generateId } from '../utils';
import { audioBufferToWav } from '../utils/audioRenderer';
import { deleteAssetFromDB, storeAssetInDB } from '../utils/db';
import { getVoiceoverGenerator, voiceoverCues, voiceoverSignature, VOICEOVER_SAMPLE_RATE, type VoiceoverVoice } from '../utils/voiceover';

interface Props {
  stateRef: MutableRefObject<ExtendedEditorState>;
  setState: Dispatch<SetStateAction<ExtendedEditorState>>;
  pushHistory: () => void;
}
export function useVoiceoverTools({ stateRef, setState, pushHistory }: Props) {
  const [status, setStatus] = useState<{ kind: 'idle' | 'confirm' | 'running' | 'done' | 'error'; message: string }>({ kind: 'idle', message: '' });
  const [voice, setVoice] = useState<VoiceoverVoice>('af_heart');
  const run = useRef<AbortController | null>(null);
  const available = typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined' && typeof AudioBuffer !== 'undefined';
  const cancel = useCallback(() => { run.current?.abort(); run.current = null; setStatus({ kind: 'idle', message: '' }); }, []);
  useEffect(() => () => { run.current?.abort(); run.current = null; }, []);
  const generate = useCallback(async (confirmed = false) => {
    if (run.current || stateRef.current.isExporting) return;
    let controller: AbortController | undefined;
    let storageId: string | undefined;
    let url: string | undefined;
    let committed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!available) throw new Error('Local speech generation is unavailable. Use the FrameCut macOS app.');
      const snapshot = stateRef.current;
      const cues = voiceoverCues(snapshot.subtitles, snapshot.duration);
      const signature = voiceoverSignature(snapshot.subtitles, snapshot.duration);
      if (!confirmed) {
        setStatus({ kind: 'confirm', message: 'Generate English speech on your device. This may download about 130 MB of model, voice and runtime files (cached where supported). Your subtitles and media are never uploaded. Existing voiceover is replaced only after success.' });
        return;
      }
      controller = new AbortController();
      run.current = controller;
      const signal = controller.signal;
      timer = setTimeout(() => controller?.abort(new Error('Voiceover timed out after 10 minutes. Try fewer subtitles or the FrameCut macOS app.')), 10 * 60 * 1000);
      setStatus({ kind: 'running', message: 'Loading local speech engine…' });
      const samples = await getVoiceoverGenerator()({ cues, duration: snapshot.duration, voice }, signal,
        message => { if (run.current === controller) setStatus({ kind: 'running', message }); });
      const unchanged = () => !signal.aborted && run.current === controller && !stateRef.current.isExporting
        && snapshot.mainVideo?.id === stateRef.current.mainVideo?.id
        && snapshot.voiceover === stateRef.current.voiceover
        && signature === voiceoverSignature(stateRef.current.subtitles, stateRef.current.duration);
      if (!unchanged()) throw new Error('The project changed during generation. Generate again from the current subtitles.');
      if (samples.length !== Math.ceil(snapshot.duration * VOICEOVER_SAMPLE_RATE) || samples.some(s => !Number.isFinite(s))) throw new Error('The speech engine returned invalid audio.');
      const buffer = new AudioBuffer({ length: samples.length, sampleRate: VOICEOVER_SAMPLE_RATE, numberOfChannels: 1 });
      buffer.copyToChannel(new Float32Array(samples), 0);
      storageId = generateId();
      const blob = audioBufferToWav(buffer);
      await storeAssetInDB(storageId, blob);
      if (!unchanged()) throw new Error('The project changed during generation. Generate again from the current subtitles.');
      url = URL.createObjectURL(blob);
      pushHistory();
      const asset = { id: storageId, storageId, src: url, name: 'AI voiceover.wav', duration: snapshot.duration, signature, voice };
      setState(prev => ({ ...prev, voiceover: asset }));
      committed = true;
      setStatus({ kind: 'done', message: 'Voiceover generated. Original audio was kept. Subtitle or timing edits require regeneration.' });
    } catch (error: unknown) {
      if (!controller || run.current === controller) {
        const reason: unknown = controller?.signal.reason instanceof Error ? controller.signal.reason : error;
        setStatus({ kind: 'error', message: reason instanceof Error ? reason.message : 'Could not generate voiceover.' });
      }
    } finally {
      if (timer) clearTimeout(timer);
      if (run.current === controller) run.current = null;
      if (!committed) { if (url) URL.revokeObjectURL(url); if (storageId) await deleteAssetFromDB(storageId).catch(() => {}); }
    }
  }, [available, pushHistory, setState, stateRef, voice]);
  const remove = useCallback(() => {
    cancel();
    if (!stateRef.current.voiceover || stateRef.current.isExporting) return;
    pushHistory();
    setState(prev => ({ ...prev, voiceover: null }));
  }, [cancel, pushHistory, setState, stateRef]);
  return { status, voice, setVoice, available, generate, cancel, remove };
}
