
import React, { useRef, useEffect, useMemo, useLayoutEffect, useCallback } from 'react';
import { Clip, Subtitle, ZoomEffect, SpotlightEffect, MosaicEffect, Selection, MediaAsset } from '../types';
import { Play, Pause } from 'lucide-react';
import { useTimelineDrag } from '../hooks/useTimelineDrag';
import TracksLayer from './TracksLayer';
import TimelineHeaders from './TimelineHeaders';

interface TimelineProps {
  duration: number;
  currentTimeRef: React.MutableRefObject<number>;
  zoomLevel: number;
  intro: MediaAsset | null;
  outro: MediaAsset | null;
  mainVideo: MediaAsset | null;
  audio: MediaAsset | null;
  clips: Clip[];
  audioClips: Clip[];
  subtitles: Subtitle[];
  zoomEffects: ZoomEffect[];
  spotlightEffects: SpotlightEffect[];
  mosaicEffects: MosaicEffect[];
  selection: Selection;
  isPlaying: boolean;
  onSeek: (time: number) => void;
  onTogglePlay: () => void;
  onSelect: (selection: Selection) => void;
  onUpdateClip: (clip: Clip) => void;
  onUpdateSubtitle: (subtitle: Subtitle) => void;
  onUpdateZoomEffect: (zoom: ZoomEffect) => void;
  onUpdateSpotlightEffect: (spotlight: SpotlightEffect) => void;
  onUpdateMosaicEffect: (mosaic: MosaicEffect) => void;
  onAddSubtitle: () => void;
  onAddZoom: () => void;
  onAddSpotlight: () => void;
  onAddMosaic: () => void;
  onInteractionStart?: () => void;
  isAudioTrackMuted?: boolean;
  onToggleAudioTrackMute?: () => void;
  onPreviewTime?: (time: number | null) => void;
}

// Helper to organize items into non-overlapping tracks
const organizeTracks = <T extends { start: number, end: number }>(items: T[]): T[][] => {
  if (items.length === 0) return [[]];
  
  // Sort by start time
  const sorted = [...items].sort((a, b) => a.start - b.start);
  const tracks: T[][] = [];

  sorted.forEach(item => {
    let placed = false;
    for (const track of tracks) {
      const last = track[track.length - 1];
      // Check if this item starts after the last one ends
      if (last.end <= item.start) {
        track.push(item);
        placed = true;
        break;
      }
    }
    if (!placed) {
      tracks.push([item]);
    }
  });

  return tracks.length > 0 ? tracks : [[]];
};

const Timeline: React.FC<TimelineProps> = React.memo(({ 
  duration, 
  currentTimeRef,
  zoomLevel, 
  intro,
  outro,
  mainVideo,
  audio,
  clips,
  audioClips,
  subtitles,
  zoomEffects,
  spotlightEffects,
  mosaicEffects,
  selection,
  isPlaying,
  onSeek,
  onTogglePlay,
  onSelect,
  onUpdateClip,
  onUpdateSubtitle,
  onUpdateZoomEffect,
  onUpdateSpotlightEffect,
  onUpdateMosaicEffect,
  onAddSubtitle,
  onAddZoom,
  onAddSpotlight,
  onAddMosaic,
  onInteractionStart,
  isAudioTrackMuted,
  onToggleAudioTrackMute,
  onPreviewTime
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const headersRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  
  // PERFORMANCE: Direct DOM ref for the Ghost Cursor (Dashed Line)
  const hoverLineRef = useRef<HTMLDivElement>(null);
  
  // INTERNAL SCRUBBING STATE (Bypasses React State for Performance)
  const isScrubbingRef = useRef(false);
  const scrubTargetXRef = useRef<number | null>(null);
  const scrubRafIdRef = useRef<number | null>(null);
  
  const prevZoomLevelRef = useRef(zoomLevel);
  const lastPreviewUpdateRef = useRef<number>(0);
  const throttleTimeoutRef = useRef<number | null>(null);
  const nextThrottleTimeRef = useRef<number | null>(null);
  
  const { 
      dragState, 
      setDragState, 
      isScrubbing: isDraggingItem, 
      setIsScrubbing: setIsDraggingItem,
      handlePlayheadMouseDown: originalPlayheadMouseDown 
  } = useTimelineDrag({
      zoomLevel,
      clips,
      audioClips,
      onUpdateClip,
      onUpdateSubtitle,
      onUpdateZoomEffect,
      onUpdateSpotlightEffect,
      onUpdateMosaicEffect,
      onSeek,
      onTogglePlay,
      currentTimeRef
  });

  const isEmpty = duration === 0;
  const totalWidth = Math.max(duration * zoomLevel, 100) + 200; 
  
  const ticks = useMemo(() => {
    if (isEmpty) return [];
    if (!Number.isFinite(duration) || duration < 0) return [];

    const minPxPerTick = 60;
    const intervals = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const tickInterval = intervals.find(i => i * zoomLevel >= minPxPerTick) || 600;

    const count = Math.ceil((duration + 10) / tickInterval) + 1;
    if (!Number.isFinite(count) || count < 0 || count > 200000) return [];

    return Array.from({ length: count }, (_, i) => i * tickInterval);
  }, [duration, isEmpty, zoomLevel]);

  const subtitleTracks = useMemo(() => organizeTracks(subtitles), [subtitles]);
  const spotlightTracks = useMemo(() => organizeTracks(spotlightEffects), [spotlightEffects]);
  const mosaicTracks = useMemo(() => organizeTracks(mosaicEffects), [mosaicEffects]);

  useLayoutEffect(() => {
      if (containerRef.current && prevZoomLevelRef.current !== zoomLevel) {
          const container = containerRef.current;
          const centerTime = currentTimeRef.current;
          const halfScreen = container.clientWidth / 2;
          const newScrollLeft = (centerTime * zoomLevel) - halfScreen;
          container.scrollLeft = Math.max(0, newScrollLeft);
          prevZoomLevelRef.current = zoomLevel;
      }
  }, [zoomLevel, currentTimeRef, totalWidth]); 

  // --- PLAYHEAD ANIMATION LOOP (PLAYBACK) ---
  useEffect(() => {
    let animationFrameId: number;

    const animatePlayhead = () => {
        // Only update playhead from React/Props if we are NOT scrubbing manually
        if (playheadRef.current && !isScrubbingRef.current) {
            playheadRef.current.style.transform = `translateX(${currentTimeRef.current * zoomLevel}px)`;
        }
        
        // Auto-scroll logic during playback
        if (isPlaying && containerRef.current && !isDraggingItem && !dragState && !isScrubbingRef.current) {
            const container = containerRef.current;
            const currentPos = currentTimeRef.current * zoomLevel;
            const scrollLeft = container.scrollLeft;
            const width = container.clientWidth;
            
            if (currentPos > scrollLeft + width * 0.9) {
                container.scrollLeft = currentPos - width * 0.1;
            }
        }

        animationFrameId = requestAnimationFrame(animatePlayhead);
    };

    animationFrameId = requestAnimationFrame(animatePlayhead);
    return () => cancelAnimationFrame(animationFrameId);
  }, [zoomLevel, isPlaying, isDraggingItem, dragState, currentTimeRef]);


  // --- OPTIMIZED SCRUBBING LOGIC (Pure JS RAF Loop) ---
  const handleScrubStart = (e: React.MouseEvent) => {
      if (isEmpty) return;
      e.stopPropagation();
      e.preventDefault(); 

      isScrubbingRef.current = true;
      if (hoverLineRef.current) hoverLineRef.current.style.display = 'none';
      if (onInteractionStart) onInteractionStart();

      // Start the RAF loop for scrubbing
      startScrubLoop();
      
      // Initial Position update
      scrubTargetXRef.current = e.clientX;

      window.addEventListener('mousemove', handleWindowScrubMove);
      window.addEventListener('mouseup', handleWindowScrubUp);
  };

  const startScrubLoop = () => {
      const loop = () => {
          if (!isScrubbingRef.current) return;

          const clientX = scrubTargetXRef.current;
          if (clientX !== null && containerRef.current) {
              const rect = containerRef.current.getBoundingClientRect();
              const scrollLeft = containerRef.current.scrollLeft;
              const x = clientX - rect.left + scrollLeft;
              const newTime = Math.max(0, x / zoomLevel);

              // 1. Update Playhead DOM (Sync with screen refresh)
              if (playheadRef.current) {
                  playheadRef.current.style.transform = `translateX(${x}px)`;
              }

              // 2. Update Ref
              currentTimeRef.current = newTime;

              // 3. Update Video (Throttled)
              throttledVideoPreview(newTime);
          }

          scrubRafIdRef.current = requestAnimationFrame(loop);
      };
      loop();
  };

  // Improved Throttle: Ensures updates happen while moving, not just when stopping
  const throttledVideoPreview = useCallback((time: number) => {
      nextThrottleTimeRef.current = time; // Always capture latest time for the pending trigger

      const now = performance.now();
      const THROTTLE_MS = 80; 
      const timeSinceLastUpdate = now - lastPreviewUpdateRef.current;

      if (timeSinceLastUpdate >= THROTTLE_MS) {
          // Ready to fire immediately
          if (onPreviewTime) onPreviewTime(time);
          lastPreviewUpdateRef.current = now;
          
          if (throttleTimeoutRef.current) {
              clearTimeout(throttleTimeoutRef.current);
              throttleTimeoutRef.current = null;
          }
      } else {
          // Schedule trailing update if not already scheduled
          // IMPORTANT: Do NOT clear existing timeout here. This was causing the "only update on stop" bug.
          if (!throttleTimeoutRef.current) {
              const remainingDelay = THROTTLE_MS - timeSinceLastUpdate;
              throttleTimeoutRef.current = window.setTimeout(() => {
                   const latestTime = nextThrottleTimeRef.current;
                   if (latestTime !== null && onPreviewTime) {
                       onPreviewTime(latestTime);
                   }
                   lastPreviewUpdateRef.current = performance.now();
                   throttleTimeoutRef.current = null;
              }, remainingDelay);
          }
      }
  }, [onPreviewTime]);

  const handleWindowScrubMove = (e: MouseEvent) => {
      // Just update the target X, let RAF handle the heavy lifting
      scrubTargetXRef.current = e.clientX;
  };

  const handleWindowScrubUp = (e: MouseEvent) => {
      isScrubbingRef.current = false;
      if (scrubRafIdRef.current) {
          cancelAnimationFrame(scrubRafIdRef.current);
          scrubRafIdRef.current = null;
      }

      // Commit final state
      if (containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          const x = e.clientX - rect.left + containerRef.current.scrollLeft;
          const finalTime = Math.max(0, x / zoomLevel);
          onSeek(finalTime); 
      }
      
      if (onPreviewTime) onPreviewTime(null);

      window.removeEventListener('mousemove', handleWindowScrubMove);
      window.removeEventListener('mouseup', handleWindowScrubUp);
  };

  // --- GHOST CURSOR LOGIC ---
  const handleContainerMouseMove = (e: React.MouseEvent) => {
    if (isEmpty || isPlaying || isScrubbingRef.current || dragState) {
      if (hoverLineRef.current) hoverLineRef.current.style.display = 'none';
      if (onPreviewTime) onPreviewTime(null);
      return;
    }

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || !containerRef.current) return;
    
    const scrollLeft = containerRef.current.scrollLeft;
    const x = e.clientX - rect.left + scrollLeft;
    
    // 1. Immediate UI Update (Ghost Cursor)
    if (hoverLineRef.current) {
        hoverLineRef.current.style.display = 'block';
        hoverLineRef.current.style.transform = `translateX(${x}px)`;
    }

    // 2. Throttled Video Preview
    const time = Math.max(0, x / zoomLevel);
    throttledVideoPreview(time);
  };

  const handleContainerMouseLeave = () => {
    if (hoverLineRef.current) hoverLineRef.current.style.display = 'none';
    
    // Clear pending throttle to stop updates when leaving
    if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
        throttleTimeoutRef.current = null;
    }
    nextThrottleTimeRef.current = null;
    
    if (onPreviewTime) onPreviewTime(null);
  };

  const handleScroll = () => {
      if (containerRef.current && headersRef.current) {
          headersRef.current.scrollTop = containerRef.current.scrollTop;
      }
  };

  const playheadColorClass = isPlaying ? 'bg-white' : 'bg-yellow-500';
  const playheadRingClass = isPlaying ? 'border-zinc-300' : 'border-yellow-600';

  return (
    <div className="flex flex-col h-full bg-zinc-900 border-t border-zinc-800 select-none">
      <div className="flex flex-1 min-h-0">
        <TimelineHeaders 
            ref={headersRef}
            isEmpty={isEmpty}
            isAudioTrackMuted={isAudioTrackMuted}
            onToggleAudioTrackMute={onToggleAudioTrackMute}
            subtitleTracks={subtitleTracks}
            spotlightTracks={spotlightTracks}
            mosaicTracks={mosaicTracks}
            onAddSubtitle={onAddSubtitle}
            onAddZoom={onAddZoom}
            onAddSpotlight={onAddSpotlight}
            onAddMosaic={onAddMosaic}
        />

        <div 
          ref={containerRef}
          className="flex-1 overflow-x-auto overflow-y-auto relative custom-scrollbar bg-zinc-900"
          onMouseDown={!isEmpty ? handleScrubStart : undefined}
          onMouseMove={!isEmpty ? handleContainerMouseMove : undefined}
          onMouseLeave={handleContainerMouseLeave}
          onScroll={handleScroll}
        >
          <TracksLayer 
             isEmpty={isEmpty}
             totalWidth={totalWidth}
             ticks={ticks}
             zoomLevel={zoomLevel}
             clips={clips}
             audioClips={audioClips}
             subtitleTracks={subtitleTracks}
             zoomEffects={zoomEffects}
             spotlightTracks={spotlightTracks}
             mosaicTracks={mosaicTracks}
             selection={selection}
             intro={intro}
             outro={outro}
             mainVideo={mainVideo}
             audio={audio}
             onSelect={onSelect}
             onSeek={onSeek}
             onInteractionStart={onInteractionStart}
             setDragState={setDragState}
             handleSeek={() => {}} // Deprecated
          />

          {/* Ghost Cursor (Hover Line) */}
          {!isEmpty && (
              <div 
                ref={hoverLineRef} 
                className="absolute top-0 bottom-0 w-[1px] bg-white/30 z-40 pointer-events-none border-l border-dashed border-white/30 hidden will-change-transform" 
                style={{ left: 0 }} 
              />
          )}
          
          {/* Playhead */}
          {!isEmpty && (
              <div 
                ref={playheadRef}
                className={`absolute top-0 bottom-0 w-[1px] ${playheadColorClass} z-50 pointer-events-none will-change-transform`}
                style={{ left: 0, transform: `translateX(${currentTimeRef.current * zoomLevel}px)` }}
              >
                {/* Playhead Handle */}
                <div 
                    className={`absolute -top-1.5 -translate-x-1/2 w-4 h-4 ${playheadColorClass} rotate-45 transform shadow-md cursor-pointer pointer-events-auto hover:scale-110 transition-transform flex items-center justify-center ring-0 border ${playheadRingClass}`} 
                    onMouseDown={(e) => { 
                        e.stopPropagation(); 
                        handleScrubStart(e); 
                    }} 
                    title={isPlaying ? "Pause" : "Play"}
                >
                    <div className="-rotate-45 text-black flex items-center justify-center">
                        {isPlaying ? <Pause size={8} fill="currentColor" strokeWidth={0} /> : <Play size={8} fill="currentColor" strokeWidth={0} className="ml-0.5" />}
                    </div>
                </div>
              </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default Timeline;
