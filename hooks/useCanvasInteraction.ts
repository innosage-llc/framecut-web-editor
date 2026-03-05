
import React, { useState, useRef, useEffect, RefObject } from 'react';
import { Subtitle, ZoomEffect, SpotlightEffect, MosaicEffect, MosaicPath, Clip } from '../types';
import { calculateZoomRect } from '../utils/canvasRenderer';

interface UseCanvasInteractionProps {
    // Replaced direct props with Refs for heavy lists
    allSubtitlesRef: React.MutableRefObject<Subtitle[]>;
    zoomEffectsRef: React.MutableRefObject<ZoomEffect[]>;
    spotlightEffectsRef: React.MutableRefObject<SpotlightEffect[]>;
    mosaicEffectsRef: React.MutableRefObject<MosaicEffect[]>;
    
    selectedZoomEffect: ZoomEffect | null;
    selectedSpotlightEffect: SpotlightEffect | null;
    selectedMosaicEffect: MosaicEffect | null;
    isPlaying: boolean;
    currentTimeRef: React.MutableRefObject<number>;
    contentRef: RefObject<HTMLDivElement>;
    currentBrushSize: number;
    onUpdateSubtitle: (sub: Subtitle) => void;
    onUpdateZoomEffect: (zoom: ZoomEffect) => void;
    onUpdateSpotlightEffect: (spotlight: SpotlightEffect) => void;
    onUpdateMosaicEffect: (mosaic: MosaicEffect) => void;
    onSelectSubtitle: (id: string) => void;
    onInteractionStart?: () => void;
    
    // Props for Crop
    activeClipId?: string;
    onUpdateClip?: (clip: Clip) => void;
    activeClipsRef: React.MutableRefObject<Clip[] | undefined>;
}

export const useCanvasInteraction = ({
    allSubtitlesRef,
    zoomEffectsRef,
    spotlightEffectsRef,
    mosaicEffectsRef,
    selectedZoomEffect,
    selectedSpotlightEffect,
    selectedMosaicEffect,
    isPlaying,
    currentTimeRef,
    contentRef,
    currentBrushSize,
    onUpdateSubtitle,
    onUpdateZoomEffect,
    onUpdateSpotlightEffect,
    onUpdateMosaicEffect,
    onSelectSubtitle,
    onInteractionStart,
    activeClipId,
    onUpdateClip,
    activeClipsRef
}: UseCanvasInteractionProps) => {
    
    const draggedItemIdRef = useRef<string | null>(null);

    // Subtitle Drag/Transform State
    const [subDragState, setSubDragState] = useState<{
        id: string;
        mode: 'move' | 'rotate' | 'scale';
        x: number;
        y: number;
        rotation: number;
        scale: number;
        startX: number;
        startY: number;
        initialAngle?: number;
        initialDistance?: number;
        startScale?: number; 
    } | null>(null);

    const [zoomDragState, setZoomDragState] = useState<{
        type: 'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br';
        startX: number;
        startY: number;
        initialBox: { x: number, y: number, width: number, height: number };
    } | null>(null);

    const [spotlightDragState, setSpotlightDragState] = useState<{
        type: 'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br';
        startX: number;
        startY: number;
        initialBox: { x: number, y: number, width: number, height: number };
    } | null>(null);

    const [mosaicDragState, setMosaicDragState] = useState<{
        type: 'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br';
        startX: number;
        startY: number;
        initialBox: { x: number, y: number, width: number, height: number };
    } | null>(null);

    const [cropDragState, setCropDragState] = useState<{
        type: 'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br';
        startX: number;
        startY: number;
        initialBox: { x: number, y: number, width: number, height: number };
    } | null>(null);

    const [isDrawing, setIsDrawing] = useState(false);
    const currentPathRef = useRef<MosaicPath | null>(null);

    // Get Active Elements Helper
    const getActiveZoom = () => {
        const time = currentTimeRef.current;
        return zoomEffectsRef.current.find(z => time >= z.start && time < z.end);
    };
    
    const getActiveMosaic = () => {
        const time = currentTimeRef.current;
        return mosaicEffectsRef.current.find(m => time >= m.start && time < m.end);
    };
    
    const getActiveClipCrop = () => {
        if (!activeClipId || !activeClipsRef.current) return undefined;
        const clip = activeClipsRef.current.find(c => c.id === activeClipId);
        return clip?.crop;
    };

    const getViewToVideoTransform = () => {
        let zoomRect = { x: 0, y: 0, width: 100, height: 100 };
        const activeZoomEffect = getActiveZoom();
        
        if (activeZoomEffect) {
            zoomRect = calculateZoomRect(activeZoomEffect, currentTimeRef.current);
        }
        
        const activeClipCrop = getActiveClipCrop();
        const baseCrop = activeClipCrop || { x: 0, y: 0, width: 100, height: 100 };
        
        return {
            x: baseCrop.x + (zoomRect.x / 100) * baseCrop.width,
            y: baseCrop.y + (zoomRect.y / 100) * baseCrop.height,
            width: (zoomRect.width / 100) * baseCrop.width,
            height: (zoomRect.height / 100) * baseCrop.height
        };
    };

    const getMousePosition = (e: React.MouseEvent) => {
        if (!contentRef.current) return null;
        
        const rect = contentRef.current.getBoundingClientRect();
        const borderLeft = contentRef.current.clientLeft || 0;
        const borderTop = contentRef.current.clientTop || 0;
        const contentWidth = contentRef.current.clientWidth;
        const contentHeight = contentRef.current.clientHeight;
        
        const clientX = e.clientX;
        const clientY = e.clientY;
        
        const relX = clientX - rect.left - borderLeft;
        const relY = clientY - rect.top - borderTop;
        
        const viewX = (relX / contentWidth) * 100;
        const viewY = (relY / contentHeight) * 100;

        return { viewX, viewY };
    };

    const handleMosaicMouseDown = (e: React.MouseEvent, type?: any) => {
        if (!selectedMosaicEffect || isPlaying) return;
        const activeMosaicEffect = getActiveMosaic();
        const isEditMode = selectedMosaicEffect.id === activeMosaicEffect?.id;
        if (!isEditMode) return;
        e.preventDefault(); e.stopPropagation(); 
        if (onInteractionStart) onInteractionStart();

        // Mode Check: Drawing or Box?
        if (selectedMosaicEffect.mode === 'box') {
            // Box Manipulation
            if (!type) return; 
            setMosaicDragState({ 
                type, 
                startX: e.clientX, 
                startY: e.clientY, 
                initialBox: { 
                    x: selectedMosaicEffect.x ?? 35, 
                    y: selectedMosaicEffect.y ?? 35, 
                    width: selectedMosaicEffect.width ?? 30, 
                    height: selectedMosaicEffect.height ?? 30 
                } 
            });
        } else {
            // Drawing Mode
            setIsDrawing(true);
            const pos = getMousePosition(e);
            if (pos) {
               const zoom = getViewToVideoTransform();
               
               const videoX = zoom.x + (pos.viewX * (zoom.width / 100));
               const videoY = zoom.y + (pos.viewY * (zoom.height / 100));
    
               currentPathRef.current = { points: [{ x: videoX, y: videoY }], brushSize: currentBrushSize || 10 };
               const updatedPaths = [...selectedMosaicEffect.paths, currentPathRef.current];
               onUpdateMosaicEffect({ ...selectedMosaicEffect, paths: updatedPaths });
            }
        }
    };

    const handleMosaicMouseMove = (e: React.MouseEvent) => {
        if (selectedMosaicEffect?.mode === 'box') return; 
        if (!isDrawing || !currentPathRef.current || !selectedMosaicEffect || !contentRef.current) return;
        e.preventDefault(); e.stopPropagation();
        
        const pos = getMousePosition(e);
        if (!pos) return;

        const zoom = getViewToVideoTransform();
        
        const videoX = zoom.x + (pos.viewX * (zoom.width / 100));
        const videoY = zoom.y + (pos.viewY * (zoom.height / 100));

        currentPathRef.current.points.push({ x: videoX, y: videoY });
        const paths = [...selectedMosaicEffect.paths];
        paths[paths.length - 1] = { ...currentPathRef.current };
        onUpdateMosaicEffect({ ...selectedMosaicEffect, paths: paths });
    };

    const handleMosaicMouseUp = () => { 
        if (isDrawing) { setIsDrawing(false); currentPathRef.current = null; } 
    };
    
    const handleSubMouseDown = (e: React.MouseEvent, sub: Subtitle, mode: 'move' | 'rotate' | 'scale' = 'move') => { 
        e.preventDefault(); e.stopPropagation(); 
        if (onInteractionStart) onInteractionStart();
        onSelectSubtitle(sub.id);
        draggedItemIdRef.current = sub.id; 

        const rect = contentRef.current?.getBoundingClientRect();
        
        // FIXED: Subtitles are Screen Space. Ignore zoom.
        const zoom = { x: 0, y: 0, width: 100, height: 100 }; 

        let initialAngle, initialDistance;
        if (rect) {
            const viewSubX = (sub.x - zoom.x) / zoom.width * 100;
            const viewSubY = (sub.y - zoom.y) / zoom.height * 100;

            const centerX = rect.left + (viewSubX / 100) * rect.width;
            const centerY = rect.top + (viewSubY / 100) * rect.height;

            if (mode === 'rotate') {
                initialAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI;
            } else if (mode === 'scale') {
                initialDistance = Math.sqrt(Math.pow(e.clientX - centerX, 2) + Math.pow(e.clientY - centerY, 2));
            }
        }
        
        setSubDragState({ 
            id: sub.id, 
            mode, 
            x: sub.x ?? 50, 
            y: sub.y ?? 80, 
            rotation: sub.rotation ?? 0, 
            scale: sub.scale ?? 1, 
            startScale: sub.scale ?? 1, 
            startX: e.clientX,
            startY: e.clientY,
            initialAngle,
            initialDistance
        }); 
    };
    
    const handleZoomMouseDown = (e: React.MouseEvent, type: any) => { 
        e.preventDefault(); e.stopPropagation(); 
        if (!selectedZoomEffect) return; 
        if (onInteractionStart) onInteractionStart();
        setZoomDragState({ type, startX: e.clientX, startY: e.clientY, initialBox: { x: selectedZoomEffect.x, y: selectedZoomEffect.y, width: selectedZoomEffect.width, height: selectedZoomEffect.height } }); 
    };
    
    const handleSpotlightMouseDown = (e: React.MouseEvent, type: any) => { 
        e.preventDefault(); e.stopPropagation(); 
        if (!selectedSpotlightEffect) return; 
        if (onInteractionStart) onInteractionStart();
        setSpotlightDragState({ type, startX: e.clientX, startY: e.clientY, initialBox: { x: selectedSpotlightEffect.x, y: selectedSpotlightEffect.y, width: selectedSpotlightEffect.width, height: selectedSpotlightEffect.height } }); 
    };

    const handleCropMouseDown = (e: React.MouseEvent, type: any) => {
        e.preventDefault(); e.stopPropagation();
        const activeClipCrop = getActiveClipCrop();
        if (!activeClipCrop) return;
        if (onInteractionStart) onInteractionStart();
        setCropDragState({ type, startX: e.clientX, startY: e.clientY, initialBox: { x: activeClipCrop.x, y: activeClipCrop.y, width: activeClipCrop.width, height: activeClipCrop.height } });
    };

    useEffect(() => {
        const handleWindowMouseMove = (e: MouseEvent) => {
          if (!contentRef.current) return;
          const rect = contentRef.current.getBoundingClientRect();
          
          if (subDragState) {
            const zoom = { x: 0, y: 0, width: 100, height: 100 };
            
            const viewSubX = (subDragState.x - zoom.x) / zoom.width * 100;
            const viewSubY = (subDragState.y - zoom.y) / zoom.height * 100;
            const centerX = rect.left + (viewSubX / 100) * rect.width;
            const centerY = rect.top + (viewSubY / 100) * rect.height;

            if (subDragState.mode === 'move') {
                let relativeX = e.clientX - rect.left; 
                let relativeY = e.clientY - rect.top;
                let viewPercentX = (relativeX / rect.width) * 100; 
                let viewPercentY = (relativeY / rect.height) * 100;
                viewPercentX = Math.max(0, Math.min(100, viewPercentX)); 
                viewPercentY = Math.max(0, Math.min(100, viewPercentY));
                const videoPercentX = zoom.x + (viewPercentX * (zoom.width / 100));
                const videoPercentY = zoom.y + (viewPercentY * (zoom.height / 100));
                setSubDragState(prev => prev ? { ...prev, x: videoPercentX, y: videoPercentY } : null);

            } else if (subDragState.mode === 'rotate') {
                const currentAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI;
                const deltaRotation = currentAngle - (subDragState.initialAngle || 0);
                setSubDragState(prev => prev ? { ...prev, rotation: (prev.rotation + deltaRotation), initialAngle: currentAngle } : null);
            } else if (subDragState.mode === 'scale') {
                const currentDistance = Math.sqrt(Math.pow(e.clientX - centerX, 2) + Math.pow(e.clientY - centerY, 2));
                const ratio = currentDistance / (subDragState.initialDistance || 1);
                const newScale = Math.max(0.2, Math.min(5, (subDragState.startScale || 1) * ratio));
                setSubDragState(prev => prev ? { ...prev, scale: newScale } : null);
            }
          }
          
          const handleBoxResize = (e: MouseEvent, rect: DOMRect, dragState: any, init: any, updateCallback: (box: any) => void) => {
             if (dragState.type === 'move') {
               const deltaXPx = e.clientX - dragState.startX; 
               const deltaYPx = e.clientY - dragState.startY;
               const newX = init.x + (deltaXPx / rect.width) * 100;
               const newY = init.y + (deltaYPx / rect.height) * 100;
               updateCallback({ x: newX, y: newY, width: init.width, height: init.height });
             } else {
                let anchorX = 0, anchorY = 0, isLeft = false, isTop = false;
                if (dragState.type.includes('tl')) { anchorX = init.x + init.width; anchorY = init.y + init.height; isLeft = true; isTop = true; }
                else if (dragState.type.includes('tr')) { anchorX = init.x; anchorY = init.y + init.height; isLeft = false; isTop = true; }
                else if (dragState.type.includes('bl')) { anchorX = init.x + init.width; anchorY = init.y; isLeft = true; isTop = false; }
                else { anchorX = init.x; anchorY = init.y; isLeft = false; isTop = false; }
                
                let mousePctX = ((e.clientX - rect.left) / rect.width) * 100;
                let mousePctY = ((e.clientY - rect.top) / rect.height) * 100;
                
                let rawWidth = Math.abs(mousePctX - anchorX); let rawHeight = Math.abs(mousePctY - anchorY);
                let sizeW = rawWidth;
                let sizeH = rawHeight;
                
                updateCallback({ 
                    x: isLeft ? anchorX - sizeW : anchorX, 
                    y: isTop ? anchorY - sizeH : anchorY, 
                    width: sizeW, 
                    height: sizeH 
                });
             }
          };

          if (zoomDragState && selectedZoomEffect) {
             const init = zoomDragState.initialBox;
             handleBoxResize(e, rect, zoomDragState, init, (newBox) => onUpdateZoomEffect({ ...selectedZoomEffect, ...newBox }));
          }
          
          if (spotlightDragState && selectedSpotlightEffect) {
             const init = spotlightDragState.initialBox;
             handleBoxResize(e, rect, spotlightDragState, init, (newBox) => onUpdateSpotlightEffect({ ...selectedSpotlightEffect, ...newBox }));
          }

          if (mosaicDragState && selectedMosaicEffect) {
             const init = mosaicDragState.initialBox;
             handleBoxResize(e, rect, mosaicDragState, init, (newBox) => onUpdateMosaicEffect({ ...selectedMosaicEffect, ...newBox }));
          }

          if (cropDragState && activeClipId && onUpdateClip && activeClipsRef.current) {
              const clip = activeClipsRef.current.find(c => c.id === activeClipId);
              if (clip) {
                  const init = cropDragState.initialBox;
                  const handleCropResize = (e: MouseEvent, rect: DOMRect, dragState: any, init: any, updateCallback: (box: any) => void) => {
                       if (dragState.type === 'move') {
                           const deltaXPx = e.clientX - dragState.startX; const deltaYPx = e.clientY - dragState.startY;
                           let newX = init.x + (deltaXPx / rect.width) * 100;
                           let newY = init.y + (deltaYPx / rect.height) * 100;
                           newX = Math.max(0, Math.min(100 - init.width, newX));
                           newY = Math.max(0, Math.min(100 - init.height, newY));
                           updateCallback({ x: newX, y: newY, width: init.width, height: init.height });
                       } else {
                           let anchorX = 0, anchorY = 0, isLeft = false, isTop = false;
                           if (dragState.type.includes('tl')) { anchorX = init.x + init.width; anchorY = init.y + init.height; isLeft = true; isTop = true; }
                           else if (dragState.type.includes('tr')) { anchorX = init.x; anchorY = init.y + init.height; isLeft = false; isTop = true; }
                           else if (dragState.type.includes('bl')) { anchorX = init.x + init.width; anchorY = init.y; isLeft = true; isTop = false; }
                           else { anchorX = init.x; anchorY = init.y; isLeft = false; isTop = false; }
                           
                           let mousePctX = ((e.clientX - rect.left) / rect.width) * 100;
                           let rawWidth = Math.abs(mousePctX - anchorX);
                           let size = rawWidth;
                           size = Math.max(5, size);
                           let newX = isLeft ? anchorX - size : anchorX;
                           let newY = isTop ? anchorY - size : anchorY;
                           if (newX < 0) { size += newX; newX = 0; }
                           if (newX + size > 100) { size = 100 - newX; }
                           if (newY < 0) { size += newY; newY = 0; }
                           if (newY + size > 100) { size = 100 - newY; }
                           newX = isLeft ? anchorX - size : anchorX;
                           newY = isTop ? anchorY - size : anchorY;
                           updateCallback({ x: newX, y: newY, width: size, height: size });
                       }
                  }
                  handleCropResize(e, rect, cropDragState, init, (newBox) => onUpdateClip({ ...clip, crop: newBox }));
              }
          }
        };

        const handleWindowMouseUp = () => {
          if (subDragState) {
            draggedItemIdRef.current = null;
            const draggedSub = allSubtitlesRef.current.find(s => s.id === subDragState.id);
            if (draggedSub) onUpdateSubtitle({ 
                ...draggedSub, 
                x: subDragState.x, 
                y: subDragState.y, 
                rotation: subDragState.rotation,
                scale: subDragState.scale
            });
            setSubDragState(null);
          }
          setZoomDragState(null); 
          setSpotlightDragState(null); 
          setCropDragState(null);
          setMosaicDragState(null);
          if (isDrawing) { setIsDrawing(false); currentPathRef.current = null; }
        };
        if (subDragState || zoomDragState || spotlightDragState || cropDragState || mosaicDragState || isDrawing) { window.addEventListener('mousemove', handleWindowMouseMove); window.addEventListener('mouseup', handleWindowMouseUp); }
        return () => { window.removeEventListener('mousemove', handleWindowMouseMove); window.removeEventListener('mouseup', handleWindowMouseUp); };
    }, [subDragState, zoomDragState, spotlightDragState, cropDragState, mosaicDragState, isDrawing, selectedZoomEffect, selectedSpotlightEffect, selectedMosaicEffect, onUpdateSubtitle, onUpdateZoomEffect, onUpdateSpotlightEffect, onUpdateMosaicEffect, activeClipId, onUpdateClip]);

    return {
        subDragState,
        handleSubMouseDown,
        handleZoomMouseDown,
        handleSpotlightMouseDown,
        handleCropMouseDown,
        handleMosaicMouseDown,
        handleMosaicMouseMove,
        handleMosaicMouseUp,
        draggedItemIdRef 
    };
};
