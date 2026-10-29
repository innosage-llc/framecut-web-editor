import React, { useRef } from 'react';
import { Captions, FileUp, FileDown, Loader2, X } from 'lucide-react';
import type { SubtitleToolStatus } from '../hooks/useSubtitleTools';
import { MACOS_APP_DOWNLOAD_URL } from '../utils/gifPlan';
import { WHISPER_MODELS, approxDownloadMB } from '../utils/whisperModels';

const MB = { tiny: approxDownloadMB(WHISPER_MODELS.tiny), base: approxDownloadMB(WHISPER_MODELS.base) };

interface Props {
  hasVideo: boolean;
  hasSubtitles: boolean;
  available: boolean;
  unavailableReason?: string;
  status: SubtitleToolStatus;
  onGenerate: () => void;
  onConfirmDownload: () => void;
  onCancel: () => void;
  onImport: (file: File) => void;
  onExport: (format: 'srt' | 'vtt') => void;
  onDismiss: () => void;
  /** Whisper model choice; omitted hides the picker. */
  model?: 'tiny' | 'base';
  onModelChange?: (m: 'tiny' | 'base') => void;
}

/** #27 subtitle tools: Generate (swappable transcriber), SRT/VTT import + export, status. */
const SubtitleTools: React.FC<Props> = ({ hasVideo, hasSubtitles, available, unavailableReason, status, onGenerate, onConfirmDownload, onCancel, onImport, onExport, onDismiss, model, onModelChange }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const running = status.kind === 'running';
  const btn = 'p-1.5 rounded-md text-zinc-400 hover:text-sky-400 hover:bg-sky-900/30 disabled:opacity-30 transition-colors';
  return (
    <div className="flex items-center gap-0.5 pl-1 border-l border-zinc-800 ml-0.5 relative">
      <button
        onClick={() => onGenerate()}
        className={btn}
        disabled={!hasVideo || running}
        aria-label="Generate subtitles"
        title={available ? 'Generate subtitles from speech (replaces earlier generated subtitles; keeps manual ones)' : (unavailableReason || 'Generate subtitles')}
        data-available={available ? 'true' : 'false'}
      >
        {running ? <Loader2 size={16} className="animate-spin text-sky-400" /> : <Captions size={16} />}
      </button>
      {model && onModelChange && (
        <select
          value={model}
          onChange={(e) => onModelChange(e.target.value === 'base' ? 'base' : 'tiny')}
          disabled={running}
          aria-label="Speech model for automatic subtitles"
          data-testid="subtitle-model"
          title={`Speech model: Standard (about ${MB.tiny} MB, faster) or Higher accuracy (about ${MB.base} MB, slower). Each is downloaded once, only after you confirm.`}
          className="bg-transparent text-[10px] text-zinc-400 hover:text-sky-400 rounded px-0.5 py-1 border border-transparent hover:border-zinc-700 disabled:opacity-30"
        >
          <option value="tiny">Standard</option>
          <option value="base">Higher accuracy</option>
        </select>
      )}
      <button onClick={() => fileRef.current?.click()} className={btn} aria-label="Import subtitles (SRT/VTT)" title="Import subtitles from an .srt or .vtt file">
        <FileUp size={15} />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".srt,.vtt,text/vtt,application/x-subrip"
        className="hidden"
        data-testid="subtitle-import-input"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onImport(f); }}
      />
      <button onClick={() => onExport('srt')} className={`${btn} text-[10px] font-semibold`} disabled={!hasSubtitles} aria-label="Export subtitles as SRT" title="Export subtitles as .srt">
        <span className="flex items-center gap-0.5"><FileDown size={14} />SRT</span>
      </button>
      <button onClick={() => onExport('vtt')} className={`${btn} text-[10px] font-semibold`} disabled={!hasSubtitles} aria-label="Export subtitles as VTT" title="Export subtitles as .vtt">
        <span className="flex items-center gap-0.5"><FileDown size={14} />VTT</span>
      </button>

      {status.kind !== 'idle' && (
        <div
          role="status"
          data-testid="subtitle-status"
          data-kind={status.kind}
          className={`absolute top-full left-0 mt-2 z-50 w-72 rounded-md border px-3 py-2 text-xs shadow-lg ${status.kind === 'error' ? 'bg-red-950 border-red-800 text-red-100' : 'bg-zinc-900 border-zinc-700 text-zinc-200'}`}
        >
          <div className="flex items-start gap-2">
            <div className="flex-1">
              {status.message}
              {status.kind === 'confirm-download' && (
                <div className="mt-2 flex gap-2">
                  <button onClick={onConfirmDownload} className="px-2 py-1 rounded bg-sky-600 text-white font-semibold" aria-label="Download model and generate subtitles">
                    Download {status.approxMB} MB &amp; generate
                  </button>
                  <button onClick={onDismiss} className="px-2 py-1 rounded bg-zinc-800" aria-label="Not now">Not now</button>
                </div>
              )}
              {(status.kind === 'unavailable' || status.kind === 'over-limit') && (
                <a href={MACOS_APP_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" className="block mt-1 underline font-semibold" data-testid="subtitle-macos-app-link">
                  Get the FrameCut macOS app
                </a>
              )}
            </div>
            {status.kind === 'confirm-download' ? null : status.kind === 'running'
              ? <button onClick={onCancel} className="underline" aria-label="Cancel subtitle generation">Cancel</button>
              : <button onClick={onDismiss} aria-label="Dismiss subtitle message"><X size={12} /></button>}
          </div>
        </div>
      )}
    </div>
  );
};

export default SubtitleTools;
