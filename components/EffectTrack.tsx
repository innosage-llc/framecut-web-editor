
import React from 'react';
import { ZoomEffect, SpotlightEffect, MosaicEffect, Selection } from '../types';
import { LucideIcon } from 'lucide-react';

interface EffectTrackProps {
    items: (ZoomEffect | SpotlightEffect | MosaicEffect)[];
    type: 'zoom' | 'spotlight' | 'mosaic';
    label: string;
    icon: LucideIcon;
    color: 'emerald' | 'amber' | 'pink'; // Supported theme colors
    zoomLevel: number;
    selection: Selection;
    onSelect: (selection: Selection) => void;
    onInteractionStart?: () => void;
    handleSeek: (e: React.MouseEvent) => void;
    setDragState: (state: any) => void;
}

const EffectTrack: React.FC<EffectTrackProps> = React.memo(({
    items, type, label, icon: Icon, color, zoomLevel, selection,
    onSelect, onInteractionStart, handleSeek, setDragState
}) => {
    // Tailwind class maps based on color prop - Significantly brightened unselected states (600/40)
    const colorMap = {
        emerald: {
            bg: 'bg-emerald-600/40 hover:bg-emerald-600/50',
            bgSelected: 'bg-emerald-600 shadow-[0_0_10px_rgba(5,150,105,0.4)]',
            border: 'border-emerald-500/50',
            borderHover: 'hover:border-emerald-400',
            text: 'text-emerald-50/90'
        },
        amber: {
            bg: 'bg-amber-600/40 hover:bg-amber-600/50',
            bgSelected: 'bg-amber-600 shadow-[0_0_10px_rgba(217,119,6,0.4)]',
            border: 'border-amber-500/50',
            borderHover: 'hover:border-amber-400',
            text: 'text-amber-50/90'
        },
        pink: {
            bg: 'bg-pink-600/40 hover:bg-pink-600/50',
            bgSelected: 'bg-pink-600 shadow-[0_0_10px_rgba(219,39,119,0.4)]',
            border: 'border-pink-500/50',
            borderHover: 'hover:border-pink-400',
            text: 'text-pink-50/90'
        }
    };

    const theme = colorMap[color];

    return (
        <div className="h-6 relative w-full group/track">
            <div className="absolute inset-0 bg-zinc-800/20 border-y border-zinc-800/50"></div>
            {items.map((item) => {
                const width = (item.end - item.start) * zoomLevel;
                const left = item.start * zoomLevel;
                const isSelected = selection?.type === type && selection.id === item.id;

                return (
                    <div
                        key={item.id}
                        className={`absolute top-0.5 bottom-0.5 rounded overflow-visible border group cursor-pointer transition-all duration-75 ${isSelected 
                            ? `${theme.bgSelected} border-yellow-400 z-20 ring-1 ring-yellow-400` 
                            : `${theme.bg} ${theme.border} ${theme.borderHover} z-10`}`}
                        style={{ left: `${left}px`, width: `${width}px` }}
                        onMouseDown={(e) => {
                            e.stopPropagation();
                            if (onInteractionStart) onInteractionStart();
                            onSelect({ type, id: item.id });
                            setDragState({ type: 'move', itemType: type, itemId: item.id, startX: e.clientX, initialItem: item });
                        }}
                    >
                        <div className={`absolute inset-0 flex items-center px-1 text-[9px] ${theme.text} overflow-hidden pointer-events-none gap-1`}>
                            <Icon size={10} />
                            <span className="truncate">{label}</span>
                        </div>
                        
                        {isSelected && (
                            <>
                                <div 
                                    className="absolute left-0 top-0 bottom-0 w-4 -ml-1 cursor-ew-resize hover:bg-yellow-400/20 rounded-l-md" 
                                    onMouseDown={(e) => { 
                                        e.stopPropagation(); 
                                        if (onInteractionStart) onInteractionStart(); 
                                        setDragState({ type: 'trim-left', itemType: type, itemId: item.id, startX: e.clientX, initialItem: item }); 
                                    }} 
                                />
                                <div 
                                    className="absolute right-0 top-0 bottom-0 w-4 -mr-1 cursor-ew-resize hover:bg-yellow-400/20 rounded-r-md" 
                                    onMouseDown={(e) => { 
                                        e.stopPropagation(); 
                                        if (onInteractionStart) onInteractionStart(); 
                                        setDragState({ type: 'trim-right', itemType: type, itemId: item.id, startX: e.clientX, initialItem: item }); 
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

export default EffectTrack;
