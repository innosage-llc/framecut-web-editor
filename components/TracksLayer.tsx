
import React, { memo } from 'react';
import { Clip, Subtitle, ZoomEffect, SpotlightEffect, MosaicEffect, Selection, MediaAsset } from '../types';
import { formatTimeShort } from '../utils';
import ClipTrack from './ClipTrack';
import EffectTrack from './EffectTrack';
import SubtitleTrack from './SubtitleTrack';
import { Scan, Lightbulb, Grid3X3 } from 'lucide-react';

interface TracksLayerProps {
    isEmpty: boolean;
    totalWidth: number;
    ticks: number[];
    zoomLevel: number;
    clips: Clip[];
    audioClips: Clip[];
    subtitleTracks: Subtitle[][];
    zoomEffects: ZoomEffect[];
    spotlightTracks: SpotlightEffect[][];
    mosaicTracks: MosaicEffect[][];
    selection: Selection;
    intro: MediaAsset | null;
    outro: MediaAsset | null;
    mainVideo: MediaAsset | null;
    audio: MediaAsset | null;
    onSelect: (selection: Selection) => void;
    onSeek: (time: number) => void;
    onInteractionStart?: () => void;
    setDragState: (state: any) => void;
    handleSeek: (e: React.MouseEvent) => void;
}

const TracksLayer: React.FC<TracksLayerProps> = memo(({ 
    isEmpty, totalWidth, ticks, zoomLevel, 
    clips, audioClips, subtitleTracks, zoomEffects, spotlightTracks, mosaicTracks, 
    selection, intro, outro, mainVideo, audio,
    onSelect, onSeek, onInteractionStart, 
    setDragState, handleSeek
}) => {

    if (isEmpty) {
        return (
            <div className="h-full w-full flex items-center justify-center opacity-20 pointer-events-none">
              <span className="text-zinc-500 text-sm">Add media from the workspace to begin</span>
            </div>
        );
    }

    return (
        <div className="relative min-h-full" style={{ width: `${totalWidth}px` }}>
            {/* Time Ticks */}
            <div className="h-6 w-full border-b border-zinc-700 bg-zinc-900/95 sticky top-0 z-30 flex items-end pointer-events-none backdrop-blur-sm">
            {ticks.map((time: number) => (
                <div key={time} className="absolute border-l border-zinc-600 h-2.5 text-[9px] text-zinc-500 pl-1 font-mono" style={{ left: `${time * zoomLevel}px` }}>{formatTimeShort(time)}</div>
            ))}
            </div>

            <div className="py-1 relative space-y-[2px] pb-10">
            {/* Track 1: Video */}
            <ClipTrack 
                clips={clips} type="video" zoomLevel={zoomLevel} selection={selection}
                intro={intro} outro={outro} mainVideo={mainVideo} audio={null}
                onSelect={onSelect} onInteractionStart={onInteractionStart}
                handleSeek={handleSeek} setDragState={setDragState} onSeek={onSeek}
            />

            {/* Track 2: Audio */}
            <ClipTrack 
                clips={audioClips} type="audio" zoomLevel={zoomLevel} selection={selection}
                intro={null} outro={null} mainVideo={null} audio={audio}
                onSelect={onSelect} onInteractionStart={onInteractionStart}
                handleSeek={handleSeek} setDragState={setDragState} onSeek={onSeek}
            />

            {/* Subtitle Tracks */}
            {subtitleTracks.map((track: Subtitle[], trackIndex: number) => (
                <SubtitleTrack 
                    key={`sub-track-${trackIndex}`}
                    track={track}
                    zoomLevel={zoomLevel}
                    selection={selection}
                    onSelect={onSelect}
                    onInteractionStart={onInteractionStart}
                    handleSeek={handleSeek}
                    setDragState={setDragState}
                />
            ))}

            {/* Zoom Effect (Single Track) */}
            <EffectTrack 
                items={zoomEffects} type="zoom" label="Zoom" icon={Scan} color="emerald"
                zoomLevel={zoomLevel} selection={selection} onSelect={onSelect}
                onInteractionStart={onInteractionStart} handleSeek={handleSeek} setDragState={setDragState}
            />

            {/* Spotlight Tracks */}
            {spotlightTracks.map((track, index) => (
                <EffectTrack 
                    key={`spot-track-${index}`}
                    items={track} type="spotlight" label="Spotlight" icon={Lightbulb} color="amber"
                    zoomLevel={zoomLevel} selection={selection} onSelect={onSelect}
                    onInteractionStart={onInteractionStart} handleSeek={handleSeek} setDragState={setDragState}
                />
            ))}

            {/* Blur Tracks */}
            {mosaicTracks.map((track, index) => (
                <EffectTrack 
                    key={`mos-track-${index}`}
                    items={track} type="mosaic" label="Blur" icon={Grid3X3} color="pink"
                    zoomLevel={zoomLevel} selection={selection} onSelect={onSelect}
                    onInteractionStart={onInteractionStart} handleSeek={handleSeek} setDragState={setDragState}
                />
            ))}
            </div>
        </div>
    );
});

export default TracksLayer;
