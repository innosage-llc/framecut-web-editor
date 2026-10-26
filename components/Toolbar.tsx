
import React, { useRef, useEffect } from 'react';
import { Play, Pause, Scissors, Trash2, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, FileAudio, Camera, Activity, Crop, Sparkles, Loader2, MousePointerClick, RotateCcw, X, Circle, Focus } from 'lucide-react';
import { Selection, Subtitle } from '../types';
import { formatTimecode } from '../utils';

interface ToolbarProps {
  isPlaying: boolean;
  selection: Selection;
  hasVideo: boolean;
  isPolishing?: boolean;
  onPlayPause: () => void;
  onStepFrame: (direction: -1 | 1) => void;
  onZoom: (direction: -1 | 1) => void;
  onSplit: () => void; 
  onCrop: () => void;
  onMagicPolish: () => void;
  /** Regenerate / repair auto zooms from in-tab click metadata. */
  onAutoZoom?: () => void;
  /** Remove auto-generated zoom regions only. */
  onRemoveAutoZooms?: () => void;
  autoZoomEnabled?: boolean;
  onToggleAutoZoom?: (enabled: boolean) => void;
  autoZoomSensitivity?: number;
  onAutoZoomSensitivity?: (value: number) => void;
  hasRecordingEvents?: boolean;
  /** #23 click polish (in-tab clicks only). */
  clickRipplesEnabled?: boolean;
  onToggleClickRipples?: (enabled: boolean) => void;
  onAutoSpotlight?: () => void;
  onDelete: () => void;
  onDetachAudio: () => void;
  onToggleDebug: () => void;
  showDebug: boolean;
  onScreenshot?: () => void;
  currentTimeRef: React.MutableRefObject<number>;
}

// DIRECT-DOM CLOCK COMPONENT (High Performance)
const TimecodeDisplay: React.FC<{ refSource: React.MutableRefObject<number>, isPlaying: boolean }> = ({ refSource, isPlaying }) => {
    const textRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        let rafId: number;
        const update = () => {
            if (textRef.current) {
                textRef.current.textContent = formatTimecode(refSource.current);
            }
            rafId = requestAnimationFrame(update);
        };
        rafId = requestAnimationFrame(update);
        return () => cancelAnimationFrame(rafId);
    }, [refSource]);
    return <div ref={textRef} className="text-zinc-500 font-mono text-xs font-medium tracking-widest select-none tabular-nums" />;
};

const Toolbar: React.FC<ToolbarProps> = ({ 
  isPlaying, selection, hasVideo, isPolishing, onPlayPause, onStepFrame, onZoom, 
  onSplit, onCrop, onMagicPolish, onAutoZoom, onRemoveAutoZooms,
  autoZoomEnabled = true, onToggleAutoZoom, autoZoomSensitivity = 0.5, onAutoZoomSensitivity,
  hasRecordingEvents, clickRipplesEnabled = true, onToggleClickRipples, onAutoSpotlight, onDelete, onDetachAudio, onToggleDebug, showDebug, onScreenshot, currentTimeRef
}) => {
  const isCropActive = selection?.type === 'crop';

  return (
    <div className="h-12 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-4 shrink-0 relative">
      <div className="flex items-center space-x-1 pr-4 z-10">
        <button onClick={onSplit} className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-white disabled:opacity-30" disabled={!hasVideo || !selection || (selection.type !== 'clip' && selection.type !== 'audio')} title="Split Clip"><Scissors size={16} /></button>
        <button 
            onClick={onCrop} 
            className={`p-1.5 rounded-md disabled:opacity-30 transition-colors ${isCropActive ? 'bg-blue-600 text-white' : 'hover:bg-zinc-800 text-zinc-400 hover:text-white'}`} 
            disabled={!hasVideo || !selection || (selection.type !== 'clip' && selection.type !== 'crop')} 
            title={isCropActive ? "Finish Cropping" : "Crop Video Clip"}
        >
            <Crop size={16} />
        </button>
        
        {/* Magic Polish Button */}
        <button 
            onClick={onMagicPolish} 
            className="p-1.5 hover:bg-purple-900/30 rounded-md text-zinc-400 hover:text-purple-400 disabled:opacity-30 transition-colors relative group" 
            disabled={!hasVideo || isPolishing} 
            title="Magic Polish (Auto-Cut Silence)"
        >
            {isPolishing ? <Loader2 size={16} className="animate-spin text-purple-500" /> : <Sparkles size={16} />}
        </button>

        {/* Click polish (#23): ripples + optional auto-spotlight from in-tab clicks only */}
        {(onToggleClickRipples || onAutoSpotlight) && (
            <div className="flex items-center gap-0.5 pl-1 border-l border-zinc-800 ml-0.5"
                 title="Click polish follows clicks captured inside this browser tab only. Imported MP4s without click metadata get no click polish.">
                {onToggleClickRipples && (
                    <button
                        onClick={() => onToggleClickRipples(!clickRipplesEnabled)}
                        className={`p-1.5 rounded-md disabled:opacity-30 transition-colors ${clickRipplesEnabled && hasRecordingEvents ? 'bg-amber-900/40 text-amber-400' : 'hover:bg-zinc-800 text-zinc-400 hover:text-amber-400'}`}
                        disabled={!hasVideo || !hasRecordingEvents}
                        title={hasRecordingEvents
                            ? (clickRipplesEnabled ? "Click ripples ON: highlight in-tab clicks in preview + export. Click to turn off." : "Click ripples OFF. Click to show ripples on in-tab clicks.")
                            : "Click ripples need a screen recording with clicks inside this tab"}
                        aria-label="Toggle Click Ripples"
                        aria-pressed={clickRipplesEnabled}
                    >
                        <Circle size={16} />
                    </button>
                )}
                {onAutoSpotlight && (
                    <button
                        onClick={onAutoSpotlight}
                        className="p-1.5 hover:bg-amber-900/30 rounded-md text-zinc-400 hover:text-amber-400 disabled:opacity-30 transition-colors"
                        disabled={!hasVideo || !hasRecordingEvents}
                        title={hasRecordingEvents
                            ? "Generate Auto Spotlight on in-tab clicks (editable; replaces previous auto spotlights)"
                            : "Auto Spotlight needs a screen recording with clicks inside this tab"}
                        aria-label="Generate Auto Spotlight"
                    >
                        <Focus size={14} />
                    </button>
                )}
                <span
                    data-testid="click-polish-limit"
                    className="hidden md:inline text-[10px] leading-tight text-zinc-500 select-none ml-1 whitespace-nowrap"
                >
                    Click polish: in-tab clicks only
                </span>
            </div>
        )}

        {/* Auto Zoom: global toggle (default on) + regenerate / remove */}
        {onAutoZoom && (
            <div className="flex items-center gap-0.5 pl-1 border-l border-zinc-800 ml-0.5"
                 title="Auto Zoom follows clicks/cursor captured inside this browser tab only. Imported MP4s without click metadata will not auto-zoom.">
                <button
                    onClick={() => onToggleAutoZoom?.(!autoZoomEnabled)}
                    className={`p-1.5 rounded-md disabled:opacity-30 transition-colors ${autoZoomEnabled ? 'bg-emerald-900/40 text-emerald-400' : 'hover:bg-zinc-800 text-zinc-400 hover:text-emerald-400'}`}
                    disabled={!hasVideo}
                    title={autoZoomEnabled
                        ? "Auto Zoom ON (default). Zooms follow in-tab clicks/cursor. Click to turn off."
                        : "Auto Zoom OFF. Click to enable (still needs in-tab click metadata)."}
                    aria-label="Toggle Auto Zoom"
                    aria-pressed={autoZoomEnabled}
                >
                    <MousePointerClick size={16} />
                </button>
                <button
                    onClick={onAutoZoom}
                    className="p-1.5 hover:bg-emerald-900/30 rounded-md text-zinc-400 hover:text-emerald-400 disabled:opacity-30 transition-colors"
                    disabled={!hasVideo || !hasRecordingEvents}
                    title={hasRecordingEvents
                        ? "Generate / regenerate Auto Zoom from in-tab clicks (keeps edited regions)"
                        : "Generate needs a screen recording with clicks inside this tab"}
                    aria-label="Generate Auto Zoom"
                >
                    <RotateCcw size={14} />
                </button>
                {onRemoveAutoZooms && (
                    <button
                        onClick={onRemoveAutoZooms}
                        className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-500 hover:text-red-400 disabled:opacity-30 transition-colors"
                        disabled={!hasVideo}
                        title="Remove auto-generated zoom regions (edited/manual segments stay)"
                        aria-label="Remove Auto Zooms"
                    >
                        <X size={14} />
                    </button>
                )}
                {onAutoZoomSensitivity && (
                    <label className="hidden sm:flex items-center gap-1 ml-1 text-[9px] text-zinc-500"
                           title="Sensitivity (0–1): low groups nearby clicks into fewer longer zooms; high creates more zooms. Soft-capped ~6–8 / min.">
                        <span>Sens</span>
                        <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={autoZoomSensitivity}
                            onChange={(e) => onAutoZoomSensitivity(parseFloat(e.target.value))}
                            className="w-14 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                            aria-label="Auto Zoom sensitivity"
                        />
                    </label>
                )}
            </div>
        )}

        <button onClick={onDelete} className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-red-400 disabled:opacity-30" disabled={!hasVideo || !selection} title="Delete"><Trash2 size={16} /></button>
        <div className="w-px h-4 bg-zinc-700 mx-2" />
        <button onClick={onDetachAudio} className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-white disabled:opacity-30" disabled={!hasVideo || !selection || selection.type !== 'clip'} title="Detach Audio"><FileAudio size={16} /></button>
        <button onClick={onScreenshot} className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-white disabled:opacity-30" disabled={!hasVideo} title="Take Screenshot"><Camera size={16} /></button>
      </div>

      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-4 z-0">
        <div className="flex items-center gap-2">
          <button onClick={() => onStepFrame(-1)} className="p-1 hover:bg-zinc-800 rounded-full text-zinc-400 disabled:opacity-30" disabled={!hasVideo}><ChevronLeft size={16} /></button>
          <button onClick={onPlayPause} className="w-8 h-8 flex items-center justify-center bg-white text-black rounded-full hover:bg-zinc-200 shadow-lg disabled:opacity-30" disabled={!hasVideo}>{isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5"/>}</button>
          <button onClick={() => onStepFrame(1)} className="p-1 hover:bg-zinc-800 rounded-full text-zinc-400 disabled:opacity-30" disabled={!hasVideo}><ChevronRight size={16} /></button>
        </div>
        <TimecodeDisplay refSource={currentTimeRef} isPlaying={isPlaying} />
      </div>

      <div className="flex items-center space-x-4 z-10">
        <div className="flex items-center space-x-1 pl-2 border-l border-zinc-800">
          <button onClick={() => onZoom(-1)} className="p-1.5 hover:bg-zinc-800 text-zinc-400"><ZoomOut size={16} /></button>
          <button onClick={() => onZoom(1)} className="p-1.5 hover:bg-zinc-800 text-zinc-400"><ZoomIn size={16} /></button>
        </div>
        <div className="flex items-center pl-2 border-l border-zinc-800">
          <button onClick={onToggleDebug} className={`p-1.5 rounded-md ${showDebug ? 'bg-green-900/30 text-green-400' : 'text-zinc-400 hover:bg-zinc-800'}`}><Activity size={16} /></button>
        </div>
      </div>
    </div>
  );
};

export default Toolbar;
