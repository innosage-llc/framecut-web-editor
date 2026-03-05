
import React, { useState, useRef, useEffect, RefObject } from 'react';
import { Clip, Subtitle, ZoomEffect, SpotlightEffect, MosaicEffect } from '../types';

export type DragItemType = 'clip' | 'audio' | 'subtitle' | 'zoom' | 'spotlight' | 'mosaic' | 'none';
export type DragActionType = 'move' | 'trim-left' | 'trim-right' | 'playhead';

export interface DragState {
    type: DragActionType;
    itemType: DragItemType;
    itemId: string;
    startX: number;
    initialItem: Clip | Subtitle | ZoomEffect | SpotlightEffect | MosaicEffect | null;
}

interface UseTimelineDragProps {
    zoomLevel: number;
    clips: Clip[];
    audioClips: Clip[];
    onUpdateClip: (clip: Clip) => void;
    onUpdateSubtitle: (sub: Subtitle) => void;
    onUpdateZoomEffect: (zoom: ZoomEffect) => void;
    onUpdateSpotlightEffect: (spot: SpotlightEffect) => void;
    onUpdateMosaicEffect: (mosaic: MosaicEffect) => void;
    onSeek: (time: number) => void;
    onTogglePlay: () => void;
    currentTimeRef: React.MutableRefObject<number>;
}

export const useTimelineDrag = ({
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
}: UseTimelineDragProps) => {
    const [dragState, setDragState] = useState<DragState | null>(null);
    const [isScrubbing, setIsScrubbing] = useState(false);
    const playheadClickStartRef = useRef<{x: number, time: number} | null>(null);

    const handlePlayheadMouseDown = (e: React.MouseEvent) => {
        e.stopPropagation();
        playheadClickStartRef.current = { x: e.clientX, time: Date.now() };
        setDragState({ 
          type: 'playhead', 
          itemType: 'none', 
          itemId: 'playhead', 
          startX: e.clientX, 
          initialItem: null 
        });
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (isScrubbing) {
            // Scrubbing logic is handled by parent via handleSeek wrapper usually, 
            // but if we are just dragging playhead via bar:
            return; 
        }
        
        if (dragState) {
          if (dragState.type === 'playhead') {
            // handled externally or via seek callback if integrated
            return;
          }
    
          const deltaX = e.clientX - dragState.startX;
          const deltaTime = deltaX / zoomLevel;
    
          if (dragState.itemType === 'clip' || dragState.itemType === 'audio') {
            const initialClip = dragState.initialItem as Clip;
            let newClip = { ...initialClip };
    
            if (dragState.type === 'move') {
               const proposedOffset = Math.max(0, initialClip.offset + deltaTime);
               
               // Snapping Logic
               const trackClips = dragState.itemType === 'clip' ? clips : audioClips;
               const snapThreshold = 10 / zoomLevel;
               const currentDuration = (initialClip.sourceEnd - initialClip.sourceStart) / initialClip.speed;
               const playhead = currentTimeRef.current;

               // Snap Candidates based on Playhead (Start->Playhead, End->Playhead) and Start of Timeline
               const snapPoints = [
                   0, 
                   playhead, 
                   playhead - currentDuration
               ];

               trackClips.forEach(c => {
                 if (c.id === initialClip.id) return;
                 const duration = (c.sourceEnd - c.sourceStart) / c.speed;
                 // Snap Start to other's End
                 snapPoints.push(c.offset + duration);
                 // Snap Start to other's Start
                 snapPoints.push(c.offset);
                 // Snap End to other's Start (Start = OtherStart - Duration)
                 snapPoints.push(c.offset - currentDuration);
                 // Snap End to other's End (Start = OtherEnd - Duration)
                 snapPoints.push((c.offset + duration) - currentDuration);
               });

               let closestSnap = proposedOffset;
               let minDiff = Infinity;

               snapPoints.forEach(point => {
                 const diff = Math.abs(proposedOffset - point);
                 if (diff < snapThreshold && diff < minDiff) {
                    minDiff = diff;
                    closestSnap = point;
                 }
               });
               newClip.offset = (minDiff < Infinity) ? closestSnap : proposedOffset;
               // Disabled seeking while dragging clip to allow snapping to stationary playhead
               // onSeek(newClip.offset);
    
            } else if (dragState.type === 'trim-left') {
               const sourceDelta = deltaTime * initialClip.speed;
               const newOffset = initialClip.offset + deltaTime;
               const newSourceStart = initialClip.sourceStart + sourceDelta;
               if (newSourceStart >= 0 && newSourceStart < initialClip.sourceEnd - 0.1) {
                  newClip.offset = newOffset;
                  newClip.sourceStart = newSourceStart;
               }
            } else if (dragState.type === 'trim-right') {
               const sourceDelta = deltaTime * initialClip.speed;
               const newSourceEnd = initialClip.sourceEnd + sourceDelta;
               if (newSourceEnd > initialClip.sourceStart + 0.1) {
                  newClip.sourceEnd = newSourceEnd;
               }
            }
            onUpdateClip(newClip);
    
          } else if (dragState.itemType === 'subtitle') {
            const initialSub = dragState.initialItem as Subtitle;
            let newSub = { ...initialSub };
            const currentDuration = initialSub.end - initialSub.start;
    
            if (dragState.type === 'move') {
              const newStart = Math.max(0, initialSub.start + deltaTime);
              newSub.start = newStart;
              newSub.end = newStart + currentDuration;
            } else if (dragState.type === 'trim-left') {
              const newStart = Math.min(initialSub.start + deltaTime, initialSub.end - 0.5);
              newSub.start = newStart;
            } else if (dragState.type === 'trim-right') {
              const newEnd = Math.max(initialSub.end + deltaTime, initialSub.start + 0.5);
              newSub.end = newEnd;
            }
            onUpdateSubtitle(newSub);
          } else if (dragState.itemType === 'zoom') {
            const initialZoom = dragState.initialItem as ZoomEffect;
            let newZoom = { ...initialZoom };
            const currentDuration = initialZoom.end - initialZoom.start;
            if (dragState.type === 'move') {
              newZoom.start = Math.max(0, initialZoom.start + deltaTime);
              newZoom.end = newZoom.start + currentDuration;
            } else if (dragState.type === 'trim-left') {
              newZoom.start = Math.min(initialZoom.start + deltaTime, initialZoom.end - 0.5);
            } else if (dragState.type === 'trim-right') {
              newZoom.end = Math.max(initialZoom.end + deltaTime, initialZoom.start + 0.5);
            }
            onUpdateZoomEffect(newZoom);
          } else if (dragState.itemType === 'spotlight') {
             const initialSpot = dragState.initialItem as SpotlightEffect;
             let newSpot = { ...initialSpot };
             const currentDuration = initialSpot.end - initialSpot.start;
             if (dragState.type === 'move') {
                newSpot.start = Math.max(0, initialSpot.start + deltaTime);
                newSpot.end = newSpot.start + currentDuration;
             } else if (dragState.type === 'trim-left') {
                newSpot.start = Math.min(initialSpot.start + deltaTime, initialSpot.end - 0.5);
             } else if (dragState.type === 'trim-right') {
                newSpot.end = Math.max(initialSpot.end + deltaTime, initialSpot.start + 0.5);
             }
             onUpdateSpotlightEffect(newSpot);
          } else if (dragState.itemType === 'mosaic') {
             const initialMosaic = dragState.initialItem as MosaicEffect;
             let newMosaic = { ...initialMosaic };
             const currentDuration = initialMosaic.end - initialMosaic.start;
             if (dragState.type === 'move') {
                newMosaic.start = Math.max(0, initialMosaic.start + deltaTime);
                newMosaic.end = newMosaic.start + currentDuration;
             } else if (dragState.type === 'trim-left') {
                newMosaic.start = Math.min(initialMosaic.start + deltaTime, initialMosaic.end - 0.5);
             } else if (dragState.type === 'trim-right') {
                newMosaic.end = Math.max(initialMosaic.end + deltaTime, initialMosaic.start + 0.5);
             }
             onUpdateMosaicEffect(newMosaic);
          }
        }
    };

    const handleMouseUp = (e: MouseEvent) => {
        setIsScrubbing(false);
        if (dragState?.type === 'playhead' && playheadClickStartRef.current) {
          const dist = Math.abs(e.clientX - playheadClickStartRef.current.x);
          if (dist < 5) onTogglePlay();
          playheadClickStartRef.current = null;
        }
        setDragState(null);
    };

    useEffect(() => {
        if (isScrubbing || dragState) {
          window.addEventListener('mousemove', handleMouseMove);
          window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
          window.removeEventListener('mousemove', handleMouseMove);
          window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isScrubbing, dragState, zoomLevel, clips, audioClips]);

    return {
        dragState,
        setDragState,
        isScrubbing,
        setIsScrubbing,
        handlePlayheadMouseDown
    };
};
