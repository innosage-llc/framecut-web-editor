
import React from 'react';
import { MousePointer2, PictureInPicture, PictureInPicture2, X, Activity } from 'lucide-react';
import { formatTimeShort } from '../utils';

interface RecordingBarProps {
    duration: number;
    markersCount: number;
    capturedEventsCount: number; // New prop
    isPiPActive: boolean;
    onMarker: () => void;
    onStop: () => void;
    onTogglePiP: () => void;
    onClose: () => void;
}

const RecordingBar: React.FC<RecordingBarProps> = ({
    duration,
    markersCount,
    capturedEventsCount,
    isPiPActive,
    onMarker,
    onStop,
    onTogglePiP,
    onClose
}) => {
    return (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-4 px-5 py-2.5 bg-[#1e1e1e] border border-zinc-700/50 rounded-lg shadow-2xl animate-in slide-in-from-top-4 select-none">
            <div className="flex items-center gap-3 border-r border-zinc-700 pr-4">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
                <span className="font-mono font-medium text-white tabular-nums text-sm tracking-wide">
                    {formatTimeShort(duration)}
                </span>
            </div>

            <div className="flex items-center gap-3">
                {/* Auto-Captured Events Indicator */}
                <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 border-r border-zinc-700 pr-3 mr-1" title="Mouse Clicks & Keys Captured">
                    <Activity size={14} className={capturedEventsCount > 0 ? "text-green-400" : "text-zinc-600"} />
                    <span>{capturedEventsCount} Events</span>
                </div>

                <button onClick={onMarker} className="flex items-center gap-1.5 text-xs font-medium text-zinc-300 hover:text-white transition-colors group">
                    <MousePointer2 size={14} className="group-hover:text-blue-400 transition-colors" />
                    <span>Marker ({markersCount})</span>
                </button>

                <button
                    onClick={onStop}
                    className="flex items-center gap-1.5 text-xs font-semibold text-[#0b57d0] bg-[#a8c7fa] hover:bg-[#8ab4f8] px-4 py-1.5 rounded-full transition-all shadow-sm"
                >
                    Stop Sharing
                </button>

                <div className="w-px h-4 bg-zinc-700 mx-1" />

                <button
                    onClick={onTogglePiP}
                    className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors ${isPiPActive ? 'text-blue-400 bg-blue-400/10' : 'text-zinc-500 hover:text-zinc-300'}`}
                    title={isPiPActive ? "Close Floating Timer" : "Open Floating Timer"}
                >
                    {isPiPActive ? <PictureInPicture2 size={14} /> : <PictureInPicture size={14} />}
                    <span className="hidden sm:inline">{isPiPActive ? 'Close Timer' : 'Open Timer'}</span>
                </button>

                <button
                    onClick={onClose}
                    className="ml-1 text-zinc-500 hover:text-zinc-300"
                    title="Hide Overlay"
                >
                    <X size={14} />
                </button>
            </div>
        </div>
    );
};

export default RecordingBar;
