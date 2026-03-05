
import React, { useRef, useEffect } from 'react';
import { Gauge, PenLine, Brush, Bold, Italic, Type } from 'lucide-react';
import { Selection, Subtitle } from '../types';

interface ToolbarContextProps {
    selection: Selection;
    selectedSubtitle?: Subtitle;
    selectedZoomScale?: number;
    selectedMosaicBrushSize?: number;
    selectedClipSpeed?: number;
    onSubtitleUpdate: (updates: Partial<Subtitle>) => void;
    onZoomScaleChange: (scale: number) => void;
    onMosaicBrushSizeChange: (size: number) => void;
    onClipSpeedChange: (speed: number) => void;
}

const ToolbarContext: React.FC<ToolbarContextProps> = ({
    selection,
    selectedSubtitle,
    selectedZoomScale,
    selectedMosaicBrushSize,
    selectedClipSpeed,
    onSubtitleUpdate,
    onZoomScaleChange,
    onMosaicBrushSizeChange,
    onClipSpeedChange
}) => {
    const inputRef = useRef<HTMLInputElement>(null);

    // Auto-focus input when a subtitle is selected
    useEffect(() => {
        if (selection?.type === 'subtitle' && inputRef.current) {
            inputRef.current.focus();
        }
    }, [selection?.id, selection?.type]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            (e.currentTarget as HTMLInputElement).blur();
        }
    };

    return (
        <div className="flex items-center space-x-4 z-10">
            {/* Clip Speed Editor */}
            {(selection?.type === 'clip' || selection?.type === 'audio') && (
                <div className="flex items-center space-x-2 animate-in fade-in slide-in-from-right-5 duration-200">
                    <span className="text-xs text-zinc-400 font-medium flex items-center gap-1">
                        <Gauge size={12} /> Speed:
                    </span>
                    <div className="flex bg-zinc-800 rounded-md border border-zinc-700 p-0.5">
                        {[0.5, 1, 1.5, 2, 4].map((speed) => (
                            <button
                                key={speed}
                                onClick={() => onClipSpeedChange(speed)}
                                className={`px-2 py-0.5 text-[10px] rounded transition-all min-w-[30px] ${selectedClipSpeed === speed
                                        ? 'bg-blue-600 text-white shadow-sm'
                                        : 'text-zinc-400 hover:text-white hover:bg-zinc-700'
                                    }`}
                            >
                                {speed}x
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Subtitle Editor */}
            {selection?.type === 'subtitle' && selectedSubtitle && (
                <div className="flex items-center gap-3 animate-in fade-in slide-in-from-right-5 duration-200">
                    {/* Text Input */}
                    <div className="flex items-center bg-zinc-800 rounded-md border border-zinc-700 focus-within:border-purple-500 focus-within:ring-1 focus-within:ring-purple-500 transition-all">
                        <div className="pl-2 text-zinc-400">
                            <PenLine size={12} />
                        </div>
                        <input
                            ref={inputRef}
                            type="text"
                            value={selectedSubtitle.text || ''}
                            onChange={(e) => onSubtitleUpdate({ text: e.target.value })}
                            onKeyDown={handleKeyDown}
                            className="bg-transparent border-none text-white text-xs px-2 py-1 w-28 focus:outline-none placeholder-zinc-500"
                            placeholder="Subtitle text..."
                        />
                    </div>

                    <div className="h-4 w-px bg-zinc-700" />

                    {/* Font Family */}
                    <select 
                        value={selectedSubtitle.fontFamily || 'Arial'} 
                        onChange={(e) => onSubtitleUpdate({ fontFamily: e.target.value })}
                        className="bg-zinc-800 border border-zinc-700 text-white text-[10px] rounded px-1 py-1 focus:outline-none w-16"
                        title="Font Family"
                    >
                        <option value="Arial">Arial</option>
                        <option value="Times New Roman">Times</option>
                        <option value="Courier New">Courier</option>
                        <option value="Verdana">Verdana</option>
                        <option value="Impact">Impact</option>
                        <option value="Comic Sans MS">Comic</option>
                    </select>

                    {/* Bold/Italic Toggles */}
                    <div className="flex bg-zinc-800 rounded-md border border-zinc-700 p-0.5">
                        <button
                            onClick={() => onSubtitleUpdate({ fontWeight: selectedSubtitle.fontWeight === 'bold' ? 'normal' : 'bold' })}
                            className={`p-1 rounded ${selectedSubtitle.fontWeight === 'bold' ? 'bg-zinc-600 text-white' : 'text-zinc-400 hover:text-white'}`}
                            title="Bold"
                        >
                            <Bold size={12} />
                        </button>
                        <button
                            onClick={() => onSubtitleUpdate({ fontStyle: selectedSubtitle.fontStyle === 'italic' ? 'normal' : 'italic' })}
                            className={`p-1 rounded ${selectedSubtitle.fontStyle === 'italic' ? 'bg-zinc-600 text-white' : 'text-zinc-400 hover:text-white'}`}
                            title="Italic"
                        >
                            <Italic size={12} />
                        </button>
                    </div>

                    {/* Colors */}
                    <div className="flex items-center gap-2">
                        <div className="relative group/picker w-5 h-5 rounded border border-zinc-600 overflow-hidden cursor-pointer" title="Text Color">
                            <input 
                                type="color" 
                                value={selectedSubtitle.color || '#ffffff'} 
                                onChange={(e) => onSubtitleUpdate({ color: e.target.value })}
                                className="absolute -top-2 -left-2 w-10 h-10 p-0 cursor-pointer opacity-0"
                            />
                            <div className="w-full h-full" style={{ backgroundColor: selectedSubtitle.color || '#ffffff' }} />
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <Type size={10} className="text-black/50 mix-blend-difference" />
                            </div>
                        </div>

                        <div className="relative group/picker w-5 h-5 rounded border border-zinc-600 overflow-hidden cursor-pointer" title="Background Color">
                            <input 
                                type="color" 
                                value={selectedSubtitle.backgroundColor?.startsWith('#') ? selectedSubtitle.backgroundColor : '#000000'} 
                                onChange={(e) => onSubtitleUpdate({ backgroundColor: e.target.value })} // Currently forces opaque hex
                                className="absolute -top-2 -left-2 w-10 h-10 p-0 cursor-pointer opacity-0"
                            />
                            {/* Toggle for Transparent vs Color */}
                            <div className="w-full h-full" style={{ backgroundColor: selectedSubtitle.backgroundColor || 'transparent' }}>
                                {(!selectedSubtitle.backgroundColor || selectedSubtitle.backgroundColor === 'transparent') && (
                                    <div className="w-full h-full bg-red-500/0 flex items-center justify-center">
                                        <div className="w-full h-[1px] bg-red-500 rotate-45 transform" />
                                    </div>
                                )}
                            </div>
                        </div>
                        {/* Quick Transparent Toggle for BG */}
                        <button 
                            onClick={() => onSubtitleUpdate({ backgroundColor: selectedSubtitle.backgroundColor === 'transparent' ? '#000000' : 'transparent' })}
                            className="text-[9px] text-zinc-500 hover:text-zinc-300 underline"
                        >
                            {selectedSubtitle.backgroundColor === 'transparent' ? 'Add BG' : 'No BG'}
                        </button>
                    </div>
                </div>
            )}

            {/* Zoom Effect Editor */}
            {selection?.type === 'zoom' && (
                <div className="flex items-center space-x-2 animate-in fade-in slide-in-from-right-5 duration-200">
                    <span className="text-xs text-zinc-400 font-medium">Scale:</span>
                    <div className="flex bg-zinc-800 rounded-md border border-zinc-700 p-0.5">
                        {[1, 1.5, 2, 3, 4].map((scale) => (
                            <button
                                key={scale}
                                onClick={() => onZoomScaleChange(scale)}
                                className={`px-1.5 py-0.5 text-[10px] rounded transition-all ${selectedZoomScale && Math.abs(selectedZoomScale - scale) < 0.1
                                        ? 'bg-emerald-600 text-white shadow-sm'
                                        : 'text-zinc-400 hover:text-white hover:bg-zinc-700'
                                    }`}
                            >
                                {scale}x
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Mosaic Brush Size Editor */}
            {selection?.type === 'mosaic' && (
                <div className="flex items-center space-x-2 animate-in fade-in slide-in-from-right-5 duration-200">
                    <span className="text-xs text-zinc-400 font-medium flex items-center gap-1">
                        <Brush size={12} /> Brush:
                    </span>
                    <div className="flex bg-zinc-800 rounded-md border border-zinc-700 p-0.5">
                        {[5, 10, 20].map((size) => (
                            <button
                                key={size}
                                onClick={() => onMosaicBrushSizeChange(size)}
                                className={`w-6 h-6 flex items-center justify-center rounded transition-all ${selectedMosaicBrushSize === size
                                        ? 'bg-pink-600 text-white shadow-sm'
                                        : 'text-zinc-400 hover:text-white hover:bg-zinc-700'
                                    }`}
                                title={`Size ${size}`}
                            >
                                <div
                                    className="bg-current rounded-full"
                                    style={{ width: Math.max(3, size / 1.5), height: Math.max(3, size / 1.5) }}
                                />
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ToolbarContext;
