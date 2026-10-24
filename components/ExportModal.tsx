
import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import {
    ASPECT_PRESETS,
    DEFAULT_GIF_OPTIONS,
    GIF_FPS_OPTIONS,
    GIF_MAX_LONGEST_SIDE,
    GIF_WARN_FILE_BYTES,
    GIF_SIZE_OPTIONS,
    VideoExportFormat,
    VideoExportSettings,
    formatBytes,
} from '../utils/exportPresets';
import { MACOS_APP_DOWNLOAD_URL, planGifExport, readDeviceBudget } from '../utils/gifPlan';

/** Suggest the FrameCut macOS app when the browser can't do the requested GIF (URL is configurable). */
export const MacAppSuggestion: React.FC<{ text: string; testId?: string }> = ({ text, testId }) => (
    <div className="rounded-lg border border-blue-500/40 bg-blue-500/10 p-3 space-y-1" data-testid={testId} role="note">
        <p className="text-[11px] text-blue-100">{text}</p>
        <p className="text-[11px] text-blue-100">
            For longer or higher-quality GIFs, use the{' '}
            <a href={MACOS_APP_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" className="underline font-semibold" data-testid="macos-app-link">
                FrameCut macOS app
            </a>.
        </p>
    </div>
);

/** Shown after a GIF export stops at the browser's size/memory limits (or had to be trimmed). */
export const GifWebLimitPrompt: React.FC<{ info: { reason: string; detail: string } | null; onClose: () => void }> = ({ info, onClose }) => {
    if (!info) return null;
    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[85] flex items-center justify-center" onClick={onClose}>
            <div role="dialog" aria-label="GIF browser limit" data-testid="gif-web-limit-prompt" className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-2xl space-y-3" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-semibold">{info.reason === 'trimmed' ? 'GIF was trimmed' : 'GIF too large for the browser'}</h3>
                <MacAppSuggestion text={info.reason === 'trimmed' ? info.detail : `${info.detail}. Try a lower frame rate or smaller size.`} />
                <div className="flex justify-end">
                    <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800">Close</button>
                </div>
            </div>
        </div>
    );
};

interface ExportModalProps {
    isExporting: boolean;
    progress: number;
    /** When true (and not exporting) the export settings dialog is shown. */
    showSettings?: boolean;
    /** Current project aspect ratio; used as the initial preset. */
    aspectRatio?: number;
    /** Timeline duration in seconds — used for GIF length warnings. */
    projectDuration?: number;
    /** Current canvas size — used for GIF resolution warnings. */
    canvasSize?: { width: number; height: number };
    initialFormat?: VideoExportFormat;
    onCloseSettings?: () => void;
    onConfirmExport?: (settings: VideoExportSettings) => void;
}

const FORMATS: { id: VideoExportFormat; label: string; hint: string }[] = [
    { id: 'mp4', label: 'MP4', hint: 'Video with audio' },
    { id: 'webm', label: 'WebM', hint: 'Video with audio' },
    { id: 'gif', label: 'GIF', hint: 'Animated, no audio' },
];

const optionClass = (active: boolean) => `px-2 py-2 rounded text-xs border transition-all text-left ${
    active ? 'bg-blue-600 border-blue-500 text-white' : 'bg-white/5 border-transparent text-zinc-300 hover:bg-white/10'
}`;

const ExportSettings: React.FC<{
    aspectRatio: number;
    initialFormat: VideoExportFormat;
    projectDuration: number;
    canvasSize: { width: number; height: number };
    onCloseSettings: () => void;
    onConfirmExport: (settings: VideoExportSettings) => void;
}> = ({
    aspectRatio, initialFormat, projectDuration, canvasSize, onCloseSettings, onConfirmExport
}) => {
    const [format, setFormat] = useState<VideoExportFormat>(initialFormat);
    const [ratio, setRatio] = useState<number>(aspectRatio);
    const [gif, setGif] = useState(DEFAULT_GIF_OPTIONS);

    useEffect(() => { setRatio(aspectRatio); }, [aspectRatio]);
    useEffect(() => { setFormat(initialFormat); }, [initialFormat]);

    // PROVISIONAL adaptive plan: what the browser export will actually produce for these settings.
    const plan = useMemo(
        () => planGifExport(canvasSize.width || 1920, canvasSize.height || 1080, projectDuration, gif, readDeviceBudget()),
        [projectDuration, canvasSize.width, canvasSize.height, gif]
    );

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[80] flex items-center justify-center" onClick={onCloseSettings}>
            <div
                role="dialog"
                aria-label="Export settings"
                className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-2xl text-left space-y-5"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Export</h3>
                    <button onClick={onCloseSettings} aria-label="Close export settings" className="text-zinc-400 hover:text-white"><X size={18} /></button>
                </div>

                <div className="space-y-2">
                    <div className="text-[10px] text-zinc-400 uppercase tracking-wider font-bold">Aspect ratio preset</div>
                    <div className="grid grid-cols-3 gap-2">
                        {ASPECT_PRESETS.map(p => (
                            <button key={p.id} data-testid={`export-ratio-${p.id}`} aria-pressed={Math.abs(ratio - p.value) < 0.01} onClick={() => setRatio(p.value)} className={optionClass(Math.abs(ratio - p.value) < 0.01)}>
                                <div className="font-semibold">{p.label}</div>
                                <div className="text-[10px] opacity-70">{p.hint}</div>
                            </button>
                        ))}
                    </div>
                    <p className="text-[10px] text-zinc-500">Changes the project canvas ratio. Content is fitted inside the new frame (letterboxed on the background colour), not cropped.</p>
                </div>

                <div className="space-y-2">
                    <div className="text-[10px] text-zinc-400 uppercase tracking-wider font-bold">Format</div>
                    <div className="grid grid-cols-3 gap-2">
                        {FORMATS.map(f => (
                            <button key={f.id} data-testid={`export-format-${f.id}`} aria-pressed={format === f.id} onClick={() => setFormat(f.id)} className={optionClass(format === f.id)}>
                                <div className="font-semibold">{f.label}</div>
                                <div className="text-[10px] opacity-70">{f.hint}</div>
                            </button>
                        ))}
                    </div>
                </div>

                {format === 'gif' && (
                    <div className="space-y-3" data-testid="gif-options">
                        <div className="grid grid-cols-2 gap-3">
                            <label className="text-xs text-zinc-300 space-y-1">
                                <span className="block text-[10px] text-zinc-400 uppercase tracking-wider font-bold">Frame rate</span>
                                <select aria-label="GIF frame rate" value={gif.fps} onChange={e => setGif({ ...gif, fps: Number(e.target.value) })} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5">
                                    {GIF_FPS_OPTIONS.map(v => <option key={v} value={v}>{v} fps</option>)}
                                </select>
                            </label>
                            <label className="text-xs text-zinc-300 space-y-1">
                                <span className="block text-[10px] text-zinc-400 uppercase tracking-wider font-bold">Max longest side</span>
                                <select aria-label="GIF max longest side" value={gif.maxLongestSide} onChange={e => setGif({ ...gif, maxLongestSide: Number(e.target.value) })} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5">
                                    {GIF_SIZE_OPTIONS.map(v => <option key={v} value={v}>{v} px{v === GIF_MAX_LONGEST_SIDE ? ' (max)' : ''}</option>)}
                                </select>
                            </label>
                        </div>
                        <label className="flex items-center gap-2 text-xs text-zinc-300">
                            <input type="checkbox" aria-label="Loop GIF" checked={gif.loop} onChange={e => setGif({ ...gif, loop: e.target.checked })} />
                            Loop forever
                        </label>

                        <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-1" data-testid="gif-plan">
                            <div className="text-[11px] text-zinc-300">
                                Output {plan.width}×{plan.height}, {plan.fps} fps, {plan.colors} colours, {plan.duration.toFixed(1)}s ·
                                estimated <span data-testid="gif-estimate">{formatBytes(plan.estimatedBytes)}</span>
                            </div>
                            {plan.downgrades.length > 0 && (
                                <p className="text-[11px] text-amber-200" data-testid="gif-downgrades">
                                    Adjusted to fit the browser limit: {plan.downgrades.join(', ')}.
                                </p>
                            )}
                            {plan.warnLarge && (
                                <p className="text-[11px] text-amber-200" data-testid="gif-size-warning" role="alert">
                                    Large GIF (over {formatBytes(GIF_WARN_FILE_BYTES)}): it may be slow to share or upload.
                                </p>
                            )}
                        </div>

                        {(plan.exceedsWebLimits || plan.downgrades.length >= 3) && (
                            <MacAppSuggestion
                                testId="gif-macos-suggestion"
                                text={plan.exceedsWebLimits
                                    ? `This project is too long for a browser GIF: only the first ${plan.duration}s will be exported.`
                                    : 'Quality was reduced to fit what the browser can encode.'}
                            />
                        )}

                        <p className="text-[10px] text-zinc-500">
                            Encoded in your browser (gifenc). Longest side ≤ {GIF_MAX_LONGEST_SIDE}px, file ≤ {formatBytes(plan.hardCapBytes)} on this device. No audio.
                        </p>
                    </div>
                )}

                <div className="flex justify-end gap-2">
                    <button onClick={onCloseSettings} className="px-3 py-2 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800">Cancel</button>
                    <button
                        data-testid="export-confirm"
                        disabled={false}
                        onClick={() => onConfirmExport({ format, aspectRatio: ratio, gif })}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        Export {format.toUpperCase()}
                    </button>
                </div>
            </div>
        </div>
    );
};

const ExportModal: React.FC<ExportModalProps> = ({
    isExporting,
    progress,
    showSettings = false,
    aspectRatio = 16 / 9,
    projectDuration = 0,
    canvasSize = { width: 1920, height: 1080 },
    initialFormat = 'mp4',
    onCloseSettings,
    onConfirmExport,
}) => {
    if (!isExporting && showSettings && onCloseSettings && onConfirmExport) {
        return (
            <ExportSettings
                aspectRatio={aspectRatio}
                initialFormat={initialFormat}
                projectDuration={projectDuration}
                canvasSize={canvasSize}
                onCloseSettings={onCloseSettings}
                onConfirmExport={onConfirmExport}
            />
        );
    }

    // Progress overlay is driven only by isExporting, so a failed export can never leave it stuck.
    if (!isExporting) return null;

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[80] flex items-center justify-center">
            <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-2xl text-center">
                <div className="mb-4 relative inline-flex items-center justify-center">
                    <Loader2 size={48} className="animate-spin text-blue-500" />
                    <span className="absolute text-[10px] font-bold">{progress}%</span>
                </div>
                <h3 className="text-lg font-semibold mb-1">Exporting...</h3>
                <p className="text-sm text-zinc-500">Please do not close this tab.</p>
            </div>
        </div>
    );
};

export default ExportModal;
