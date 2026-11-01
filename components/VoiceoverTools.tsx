import { useState } from 'react';
import { AudioLines } from 'lucide-react';
import type { useVoiceoverTools } from '../hooks/useVoiceoverTools';
import { VOICEOVER_VOICES, type VoiceoverVoice } from '../utils/voiceover';
import { MACOS_APP_DOWNLOAD_URL } from '../utils/gifPlan';

interface Props { tools: ReturnType<typeof useVoiceoverTools>; hasSubtitles: boolean; hasVoiceover: boolean; stale: boolean; disabled: boolean }
export function VoiceoverTools({ tools, hasSubtitles, hasVoiceover, stale, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const running = tools.status.kind === 'running';
  return <div className="relative">
    <button type="button" onClick={() => setOpen(v => !v)} className="p-1.5 rounded-md text-zinc-400 hover:text-sky-400 hover:bg-sky-900/30" aria-label="AI voiceover" title="Generate AI voiceover from subtitles" aria-expanded={open}><AudioLines size={16} /></button>
    {open && <div className="absolute bottom-full mb-2 left-0 z-50 w-80 rounded border border-zinc-700 bg-zinc-900 p-3 text-xs shadow-xl space-y-2" data-testid="voiceover-tools">
      <p>English voiceover from subtitles · up to 3 minutes. Speech must fit each cue. Original audio is kept; use track mutes to hear voiceover alone.</p>
      <p>Generated audio stays at its original timeline positions. Regenerate after editing subtitles or video timing.</p>
      <label className="block">Voice <select aria-label="Voiceover voice" value={tools.voice} disabled={running || disabled} onChange={e => tools.setVoice(e.target.value as VoiceoverVoice)} className="bg-zinc-800 p-1 rounded">
        {Object.entries(VOICEOVER_VOICES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      {stale && <p role="status">Subtitles or project duration changed. Regenerate the voiceover.</p>}
      {!tools.available && <p>Local speech generation is unavailable in this browser.</p>}
      <p role="status" data-testid="voiceover-status">{tools.status.message}</p>
      <div className="flex gap-2">
        {running ? <button onClick={tools.cancel} className="underline">Cancel voiceover</button> :
          <button disabled={!hasSubtitles || disabled || !tools.available} onClick={() => tools.generate(tools.status.kind === 'confirm')} className="rounded bg-sky-700 p-1 disabled:opacity-40">{tools.status.kind === 'confirm' ? 'Download / load & generate' : hasVoiceover ? 'Regenerate voiceover' : 'Generate voiceover'}</button>}
        {hasVoiceover && <button disabled={disabled} onClick={tools.remove} className="underline">Remove voiceover</button>}
      </div>
      <a href="/licenses/NOTICE.txt" target="_blank" rel="noopener noreferrer" className="block underline">Speech engine licenses and source</a>
      <a href={MACOS_APP_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" className="block underline">Get the FrameCut macOS app for larger projects</a>
    </div>}
  </div>;
}
