
import React, { memo } from 'react';
import { Subtitle, Selection } from '../types';

interface SubtitleTrackProps {
    track: Subtitle[];
    zoomLevel: number;
    selection: Selection;
    onSelect: (selection: Selection) => void;
    onInteractionStart?: () => void;
    handleSeek: (e: React.MouseEvent) => void;
    setDragState: (state: any) => void;
}

const SubtitleTrack: React.FC<SubtitleTrackProps> = memo(({
    track, zoomLevel, selection, onSelect, onInteractionStart, handleSeek, setDragState
}) => {
    return (
        <div className="h-6 relative w-full group/track">
            <div className="absolute inset-0 bg-zinc-800/20 border-y border-zinc-800/50"></div>
            {track.map((sub) => {
                const width = (sub.end - sub.start) * zoomLevel;
                const left = sub.start * zoomLevel;
                const isSelected = selection?.type === 'subtitle' && selection.id === sub.id;
                
                return (
                    <div 
                        key={sub.id} 
                        // Brighter unselected state (bg-purple-600/40)
                        className={`absolute top-0.5 bottom-0.5 rounded overflow-visible border group cursor-pointer transition-colors duration-75 ${isSelected ? 'bg-purple-600 shadow-[0_0_10px_rgba(147,51,234,0.4)] border-yellow-400 z-20 ring-1 ring-yellow-400' : 'bg-purple-600/40 border-purple-500/50 hover:border-purple-400 z-10'}`} 
                        style={{ left: `${left}px`, width: `${width}px` }} 
                        onMouseDown={(e) => { 
                            e.stopPropagation(); 
                            if (onInteractionStart) onInteractionStart(); 
                            onSelect({ type: 'subtitle', id: sub.id }); 
                            setDragState({ type: 'move', itemType: 'subtitle', itemId: sub.id, startX: e.clientX, initialItem: sub }); 
                        }}
                    >
                        <div className="absolute inset-0 flex items-center px-1 text-[9px] text-purple-100/90 overflow-hidden pointer-events-none">
                            <span className="truncate">{sub.text}</span>
                        </div>
                        {isSelected && (
                            <>
                                <div 
                                    className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-yellow-400/20 rounded-l-md" 
                                    onMouseDown={(e) => { 
                                        e.stopPropagation(); 
                                        if (onInteractionStart) onInteractionStart(); 
                                        setDragState({ type: 'trim-left', itemType: 'subtitle', itemId: sub.id, startX: e.clientX, initialItem: sub }); 
                                    }} 
                                />
                                <div 
                                    className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-yellow-400/20 rounded-r-md" 
                                    onMouseDown={(e) => { 
                                        e.stopPropagation(); 
                                        if (onInteractionStart) onInteractionStart(); 
                                        setDragState({ type: 'trim-right', itemType: 'subtitle', itemId: sub.id, startX: e.clientX, initialItem: sub }); 
                                    }} 
                                />
                            </>
                        )}
                    </div>
                );
            })}
        </div>
    );
});

export default SubtitleTrack;
