
import React, { memo, forwardRef } from 'react';
import { Video, Volume2, VolumeX, Type, Scan, Lightbulb, Grid3X3, Mic } from 'lucide-react';
import { Subtitle, SpotlightEffect, MosaicEffect, AudioRole } from '../types';

interface TimelineHeadersProps {
    isEmpty: boolean;
    isAudioTrackMuted?: boolean;
    onToggleAudioTrackMute?: () => void;
    /** #28 lane mutes (A1 System, A2 Narration). A3 Music is the existing audio-track mute. */
    mutedAudioRoles?: AudioRole[];
    hasNarration?: boolean;
    onSetAudioRoleMuted?: (role: AudioRole, muted: boolean) => void;
    subtitleTracks: Subtitle[][];
    spotlightTracks: SpotlightEffect[][];
    mosaicTracks: MosaicEffect[][];
    onAddSubtitle: () => void;
    onAddZoom: () => void;
    onAddSpotlight: () => void;
    onAddMosaic: () => void;
}

const TimelineHeaders = memo(forwardRef<HTMLDivElement, TimelineHeadersProps>(({
    isEmpty,
    isAudioTrackMuted,
    onToggleAudioTrackMute,
    mutedAudioRoles = [],
    hasNarration = false,
    onSetAudioRoleMuted,
    subtitleTracks,
    spotlightTracks,
    mosaicTracks,
    onAddSubtitle,
    onAddZoom,
    onAddSpotlight,
    onAddMosaic
}, ref) => {
    // Opacity logic: Removed opacity reduction for empty state to ensure buttons always look clickable/active
    const containerClass = `py-1 space-y-[2px] flex-1 overflow-hidden pb-10 bg-zinc-900 ${isEmpty ? '' : ''} pointer-events-auto`;

    // Common button class for consistency and better contrast
    const trackBtnClass = "w-full h-full flex items-center justify-center text-zinc-300 hover:text-white bg-zinc-800/40 hover:bg-zinc-700 transition-all cursor-pointer pointer-events-auto border-r-2 border-transparent relative group";
    const trackIconClass = "transition-transform group-hover:scale-110";

    return (
        <div className="w-14 flex-shrink-0 bg-zinc-950 border-r border-zinc-800 flex flex-col z-50 shadow-[4px_0_10px_rgba(0,0,0,0.3)] relative">
            {/* Header Spacer (Syncs with Time Ticks sticky top) */}
            <div className="h-6 border-b border-zinc-700 bg-zinc-900 w-full shrink-0 z-50" />

            {/* Scrollable Track Headers Container */}
            <div ref={ref} className={containerClass}>

                {/* Video Track + A1 System Audio lane mute (#28) */}
                <div title="Video Track" className="h-10 flex items-center justify-center gap-1 text-zinc-400 bg-zinc-900/50 border-r-2 border-transparent">
                    <Video size={14} className="text-blue-500" />
                    <button
                        type="button"
                        title={mutedAudioRoles.includes('system') ? 'Unmute System Audio (A1)' : 'Mute System Audio (A1)'}
                        aria-pressed={mutedAudioRoles.includes('system')}
                        data-testid="lane-mute-system"
                        onClick={() => onSetAudioRoleMuted?.('system', !mutedAudioRoles.includes('system'))}
                        className="flex flex-col items-center text-[8px] leading-none hover:text-white cursor-pointer pointer-events-auto"
                    >
                        {mutedAudioRoles.includes('system') ? <VolumeX size={12} className="text-red-500" /> : <Volume2 size={12} className="text-blue-400" />}
                        A1
                    </button>
                </div>

                {/* A2 Narration (only when present) */}
                {hasNarration && (
                    <button
                        type="button"
                        title={mutedAudioRoles.includes('narration') ? 'Unmute Narration (A2)' : 'Mute Narration (A2)'}
                        aria-pressed={mutedAudioRoles.includes('narration')}
                        data-testid="lane-mute-narration"
                        onClick={() => onSetAudioRoleMuted?.('narration', !mutedAudioRoles.includes('narration'))}
                        className="h-10 w-full flex flex-col items-center justify-center text-[8px] leading-none text-zinc-400 hover:text-white bg-zinc-900/50 hover:bg-zinc-800 border-r-2 border-transparent transition-colors cursor-pointer pointer-events-auto"
                    >
                        {mutedAudioRoles.includes('narration') ? <VolumeX size={14} className="text-red-500" /> : <Mic size={14} className="text-teal-400" />}
                        A2
                    </button>
                )}

                {/* A3 Music (existing audio-track mute) */}
                <button
                    title={isAudioTrackMuted ? "Unmute Music (A3)" : "Mute Music (A3)"}
                    aria-pressed={!!isAudioTrackMuted}
                    data-testid="lane-mute-music"
                    onClick={onToggleAudioTrackMute}
                    className="h-10 w-full flex flex-col items-center justify-center text-[8px] leading-none text-zinc-400 hover:text-white bg-zinc-900/50 hover:bg-zinc-800 border-r-2 border-transparent transition-colors cursor-pointer pointer-events-auto"
                >
                    {isAudioTrackMuted ? <VolumeX size={14} className="text-red-500" /> : <Volume2 size={14} className="text-orange-500" />}
                    A3
                </button>

                {/* Subtitle Tracks (Dynamic) */}
                {subtitleTracks.map((_, index) => (
                    <div key={`sub-track-${index}`} className="w-full h-6 border-r-2 border-transparent relative">
                        {index === 0 ? (
                            <button
                                onClick={onAddSubtitle}
                                className={trackBtnClass}
                                title="Add Subtitle"
                            >
                                <Type size={14} className={`text-purple-500 ${trackIconClass}`} />
                                <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 bg-zinc-800 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-[100] shadow-lg">Add Subtitle</div>
                            </button>
                        ) : (
                            <div className="w-full h-full flex items-center justify-center bg-zinc-900/30" title={`Subtitle Track ${index + 1}`}>
                                <Type size={12} className="text-purple-900/50" />
                            </div>
                        )}
                    </div>
                ))}

                {/* Zoom Effect (Single Track) */}
                <div className="w-full h-6 border-r-2 border-transparent relative">
                    <button
                        onClick={onAddZoom}
                        title="Add Zoom Effect"
                        className={trackBtnClass}
                    >
                        <Scan size={14} className={`text-emerald-500 ${trackIconClass}`} />
                        <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 bg-zinc-800 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-[100] shadow-lg">Add Zoom</div>
                    </button>
                </div>

                {/* Spotlight Tracks (Dynamic) */}
                {spotlightTracks.map((_, index) => (
                    <div key={`spot-track-${index}`} className="w-full h-6 border-r-2 border-transparent relative">
                        {index === 0 ? (
                            <button
                                onClick={onAddSpotlight}
                                title="Add Spotlight Effect"
                                className={trackBtnClass}
                            >
                                <Lightbulb size={14} className={`text-amber-500 ${trackIconClass}`} />
                                <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 bg-zinc-800 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-[100] shadow-lg">Add Spotlight</div>
                            </button>
                        ) : (
                            <div className="w-full h-full flex items-center justify-center bg-zinc-900/30" title={`Spotlight Track ${index + 1}`}>
                                <Lightbulb size={12} className="text-amber-900/50" />
                            </div>
                        )}
                    </div>
                ))}

                {/* Blur Tracks (Dynamic) */}
                {mosaicTracks.map((_, index) => (
                    <div key={`mos-track-${index}`} className="w-full h-6 border-r-2 border-transparent relative">
                        {index === 0 ? (
                            <button
                                onClick={onAddMosaic}
                                title="Add Blur Effect"
                                className={trackBtnClass}
                            >
                                <Grid3X3 size={14} className={`text-pink-500 ${trackIconClass}`} />
                                <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 bg-zinc-800 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-[100] shadow-lg">Add Blur</div>
                            </button>
                        ) : (
                            <div className="w-full h-full flex items-center justify-center bg-zinc-900/30" title={`Blur Track ${index + 1}`}>
                                <Grid3X3 size={12} className="text-pink-900/50" />
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}));

export default TimelineHeaders;
