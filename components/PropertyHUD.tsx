
import React, { useState } from 'react';
import { Selection, Subtitle, ZoomEffect, SpotlightEffect, MosaicEffect, Clip, ExtendedEditorState } from '../types';
import { Type, Move, Lightbulb, Grid3X3, Palette, Bold, Italic, Settings, Layout, Monitor, X, MousePointer2, PenLine, AlignCenter } from 'lucide-react';

interface PropertyHUDProps {
    selection: Selection;
    selectedSubtitle?: Subtitle;
    selectedZoom?: ZoomEffect;
    selectedSpotlight?: SpotlightEffect;
    selectedMosaic?: MosaicEffect;
    currentBrushSize?: number;
    
    // Project Settings
    projectName?: string | null;
    canvasBackgroundColor?: string;
    aspectRatio?: number;

    onUpdateSubtitle: (updates: Partial<Subtitle>) => void;
    onUpdateZoom: (updates: Partial<ZoomEffect>) => void;
    onUpdateSpotlight: (updates: Partial<SpotlightEffect>) => void;
    onUpdateMosaic: (updates: Partial<MosaicEffect>) => void;
    onBrushSizeChange: (size: number) => void;
    onUpdateProjectSettings: (updates: Partial<ExtendedEditorState>) => void;
    onDeselect: () => void;
}

const PropertyHUD: React.FC<PropertyHUDProps> = ({
    selection,
    selectedSubtitle,
    selectedZoom,
    selectedSpotlight,
    selectedMosaic,
    currentBrushSize,
    projectName,
    canvasBackgroundColor,
    aspectRatio,
    onUpdateSubtitle,
    onUpdateZoom,
    onUpdateSpotlight,
    onUpdateMosaic,
    onBrushSizeChange,
    onUpdateProjectSettings,
    onDeselect
}) => {
    const [showSettings, setShowSettings] = useState(false);

    // Helpers to merge updates with existing item state to preserve ID and other props
    const handleSubtitleUpdate = (updates: Partial<Subtitle>) => {
        if (selectedSubtitle) onUpdateSubtitle({ ...selectedSubtitle, ...updates });
    };

    const handleZoomUpdate = (updates: Partial<ZoomEffect>) => {
        if (selectedZoom) onUpdateZoom({ ...selectedZoom, ...updates });
    };

    const handleSpotlightUpdate = (updates: Partial<SpotlightEffect>) => {
        if (selectedSpotlight) onUpdateSpotlight({ ...selectedSpotlight, ...updates });
    };

    const handleMosaicUpdate = (updates: Partial<MosaicEffect>) => {
        if (selectedMosaic) onUpdateMosaic({ ...selectedMosaic, ...updates });
    };

    // If no selection and not showing settings, show a gear button
    if (!selection) {
        if (!showSettings) {
            return (
                <button 
                    onClick={() => setShowSettings(true)}
                    className="absolute top-4 right-4 p-2 bg-black/60 hover:bg-black/80 text-white rounded-full backdrop-blur-md border border-white/10 shadow-lg transition-all hover:scale-110 z-50 group"
                    title="Project Settings"
                >
                    <Settings size={18} className="group-hover:rotate-45 transition-transform duration-500" />
                </button>
            );
        }
        // Show Project Settings Card (Positioned to the RIGHT of the video container)
        return (
            <div className="absolute top-0 left-full ml-4 w-64 bg-black/80 backdrop-blur-md border border-zinc-700/50 rounded-2xl shadow-2xl p-4 text-white z-50 animate-in fade-in slide-in-from-left-4 duration-200">
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/10">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <Settings size={14} className="text-zinc-400" /> Project Settings
                    </div>
                    <button onClick={() => setShowSettings(false)} className="text-zinc-400 hover:text-white"><X size={14} /></button>
                </div>

                <div className="space-y-4">
                    <div className="space-y-1">
                        <label className="text-[10px] text-zinc-400 uppercase tracking-wider font-bold">Name</label>
                        <input
                            type="text"
                            value={projectName || ''}
                            onChange={(e) => onUpdateProjectSettings({ fileName: e.target.value })}
                            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500 transition-colors"
                            placeholder="Untitled Project"
                        />
                    </div>

                    <div className="space-y-1">
                        <label className="text-[10px] text-zinc-400 uppercase tracking-wider font-bold flex items-center gap-1"><Layout size={10}/> Ratio</label>
                        <div className="grid grid-cols-3 gap-1">
                            {[
                                { label: "16:9", val: 16/9 },
                                { label: "9:16", val: 9/16 },
                                { label: "1:1", val: 1 },
                            ].map(opt => (
                                <button
                                    key={opt.label}
                                    onClick={() => onUpdateProjectSettings({ aspectRatio: opt.val })}
                                    className={`px-1 py-1.5 rounded text-[10px] border transition-all ${
                                        aspectRatio && Math.abs(aspectRatio - opt.val) < 0.01
                                        ? 'bg-blue-600 border-blue-500 text-white'
                                        : 'bg-white/5 border-transparent text-zinc-400 hover:bg-white/10'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-[10px] text-zinc-400 uppercase tracking-wider font-bold flex items-center gap-1"><Monitor size={10}/> Background</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={canvasBackgroundColor || '#000000'}
                                onChange={(e) => onUpdateProjectSettings({ canvasBackgroundColor: e.target.value })}
                                className="w-8 h-8 rounded cursor-pointer border-0 p-0 bg-transparent"
                            />
                            <span className="text-xs font-mono text-zinc-300">{canvasBackgroundColor}</span>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const TEXT_STYLE_PRESETS = [
        {
            name: 'Subtitle',
            style: {
                color: '#ffffff',
                backgroundColor: 'transparent',
                fontWeight: 'bold',
                fontStyle: 'normal',
                strokeWidth: 0,
                textShadow: true,
                shadowColor: 'black',
                shadowBlur: 20
            },
            previewClass: 'bg-zinc-700 text-white shadow-sm'
        },
        {
            name: 'Label',
            style: {
                color: '#ffffff',
                backgroundColor: '#7e22ce', // Purple
                fontWeight: 'bold',
                fontStyle: 'normal',
                strokeWidth: 0,
                textShadow: false
            },
            previewClass: 'bg-purple-600 text-white'
        },
        {
            name: 'Heading',
            style: {
                color: '#ffffff',
                backgroundColor: 'transparent',
                fontWeight: 'bold',
                fontStyle: 'normal',
                strokeWidth: 5,
                strokeColor: '#000000',
                textShadow: false
            },
            previewClass: 'bg-white text-white border border-zinc-500' // Preview tricky for stroke, just show generic
        },
        {
            name: 'Minimal',
            style: {
                color: '#ffffff',
                backgroundColor: 'transparent',
                fontWeight: 'normal',
                fontStyle: 'normal',
                strokeWidth: 0,
                textShadow: false
            },
            previewClass: 'bg-black border border-zinc-700 text-white font-light'
        }
    ];

    // Render Item Properties (Also positioned to the right to keep video clean)
    return (
        <div className="absolute top-0 left-full ml-4 w-64 bg-black/80 backdrop-blur-md border border-zinc-700/50 rounded-2xl shadow-2xl p-4 text-white z-50 animate-in fade-in slide-in-from-left-4 duration-200">
            <button 
                onClick={onDeselect}
                className="absolute top-2 right-2 p-1 text-zinc-500 hover:text-white transition-colors rounded-full hover:bg-white/10"
            >
                <X size={14} />
            </button>

            {selection.type === 'subtitle' && selectedSubtitle && (
                <div className="space-y-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-purple-400 pb-2 border-b border-white/10">
                        <Type size={16} /> Text
                    </div>
                    
                    {/* Style Presets */}
                    <div>
                        <div className="text-[10px] text-zinc-400 mb-1">Quick Styles</div>
                        <div className="grid grid-cols-4 gap-2 mb-3">
                            {TEXT_STYLE_PRESETS.map((preset) => (
                                <button
                                    key={preset.name}
                                    onClick={() => handleSubtitleUpdate(preset.style as any)}
                                    className={`h-8 rounded-md flex items-center justify-center text-[10px] font-medium transition-transform active:scale-95 border border-transparent hover:border-white/20 relative overflow-hidden group ${preset.previewClass}`}
                                    title={`Apply ${preset.name} Style`}
                                >
                                    {preset.name === 'Heading' ? (
                                        <span className="text-white" style={{ textShadow: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000' }}>Aa</span>
                                    ) : (
                                        <span>Aa</span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Text Input - Explicitly textarea for multi-line */}
                    <textarea
                        value={selectedSubtitle.text}
                        onChange={(e) => handleSubtitleUpdate({ text: e.target.value })}
                        className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:border-purple-500 resize-none h-20 leading-relaxed"
                        placeholder="Type text..."
                    />

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-[10px] text-zinc-400 block mb-1">Size</label>
                            <input
                                type="range"
                                min="50" max="200" step="5"
                                value={selectedSubtitle.fontSize || 100}
                                onChange={(e) => handleSubtitleUpdate({ fontSize: parseInt(e.target.value) })}
                                className="w-full h-1 bg-zinc-600 rounded-lg appearance-none cursor-pointer accent-purple-500"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] text-zinc-400 block mb-1">Color</label>
                            <div className="flex gap-2">
                                <input
                                    type="color"
                                    value={selectedSubtitle.color || '#ffffff'}
                                    onChange={(e) => handleSubtitleUpdate({ color: e.target.value })}
                                    className="w-6 h-6 rounded-full overflow-hidden border-0 p-0 cursor-pointer"
                                />
                                <div className="relative group w-6 h-6 rounded-full overflow-hidden border border-zinc-600 cursor-pointer" title="Background Color">
                                    <input
                                        type="color"
                                        value={selectedSubtitle.backgroundColor?.startsWith('#') ? selectedSubtitle.backgroundColor : '#000000'}
                                        onChange={(e) => handleSubtitleUpdate({ backgroundColor: e.target.value })}
                                        className="absolute -top-2 -left-2 w-10 h-10 p-0 opacity-0 cursor-pointer"
                                    />
                                    <div className="w-full h-full" style={{ backgroundColor: selectedSubtitle.backgroundColor || 'transparent' }}>
                                        {(!selectedSubtitle.backgroundColor || selectedSubtitle.backgroundColor === 'transparent') && (
                                            <div className="w-full h-full flex items-center justify-center">
                                                <div className="w-full h-[1px] bg-red-500 rotate-45" />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex gap-2">
                        <button
                            onClick={() => handleSubtitleUpdate({ fontWeight: selectedSubtitle.fontWeight === 'bold' ? 'normal' : 'bold' })}
                            className={`flex-1 py-1.5 rounded border text-xs flex justify-center items-center gap-1 transition-colors ${selectedSubtitle.fontWeight === 'bold' ? 'bg-purple-600 border-purple-500 text-white' : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white'}`}
                        >
                            <Bold size={12} /> Bold
                        </button>
                        <button
                            onClick={() => handleSubtitleUpdate({ fontStyle: selectedSubtitle.fontStyle === 'italic' ? 'normal' : 'italic' })}
                            className={`flex-1 py-1.5 rounded border text-xs flex justify-center items-center gap-1 transition-colors ${selectedSubtitle.fontStyle === 'italic' ? 'bg-purple-600 border-purple-500 text-white' : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white'}`}
                        >
                            <Italic size={12} /> Italic
                        </button>
                    </div>
                </div>
            )}

            {selection.type === 'zoom' && selectedZoom && (
                <div className="space-y-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-emerald-400 pb-2 border-b border-white/10">
                        <Move size={16} /> Zoom
                    </div>
                    <div>
                        <div className="flex justify-between text-[10px] text-zinc-400 mb-1">
                            <span>Scale</span>
                            <span>{(100 / selectedZoom.width).toFixed(1)}x</span>
                        </div>
                        <input
                            type="range"
                            min="20" max="100" step="1"
                            // Reverse logic: Smaller width = Larger scale
                            value={selectedZoom.width} 
                            onChange={(e) => {
                                const w = parseInt(e.target.value);
                                // Maintain aspect ratio of the zoom box (assuming square for simplicity or keep ratio)
                                const ratio = selectedZoom.width / selectedZoom.height;
                                handleZoomUpdate({ width: w, height: w / ratio });
                            }}
                            className="w-full h-1 bg-zinc-600 rounded-lg appearance-none cursor-pointer accent-emerald-500 transform rotate-180"
                        />
                    </div>
                </div>
            )}

            {selection.type === 'spotlight' && selectedSpotlight && (
                <div className="space-y-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-amber-400 pb-2 border-b border-white/10">
                        <Lightbulb size={16} /> Spotlight
                    </div>
                    <div>
                        <div className="flex justify-between text-[10px] text-zinc-400 mb-1">
                            <span>Intensity</span>
                            <span>{Math.round((selectedSpotlight.intensity || 0.85) * 100)}%</span>
                        </div>
                        <input
                            type="range"
                            min="0" max="1" step="0.05"
                            value={selectedSpotlight.intensity ?? 0.85}
                            onChange={(e) => handleSpotlightUpdate({ intensity: parseFloat(e.target.value) })}
                            className="w-full h-1 bg-zinc-600 rounded-lg appearance-none cursor-pointer accent-amber-500"
                        />
                    </div>
                    <div>
                        <div className="flex justify-between text-[10px] text-zinc-400 mb-1">
                            <span>Shape</span>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => handleSpotlightUpdate({ shape: 'circle' })}
                                className={`flex-1 py-1 rounded text-xs border ${selectedSpotlight.shape !== 'rectangle' ? 'bg-amber-600 border-amber-500' : 'bg-white/5 border-white/10 text-zinc-400'}`}
                            >
                                Circle
                            </button>
                            <button
                                onClick={() => handleSpotlightUpdate({ shape: 'rectangle' })}
                                className={`flex-1 py-1 rounded text-xs border ${selectedSpotlight.shape === 'rectangle' ? 'bg-amber-600 border-amber-500' : 'bg-white/5 border-white/10 text-zinc-400'}`}
                            >
                                Rect
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {selection.type === 'mosaic' && selectedMosaic && (
                <div className="space-y-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-pink-400 pb-2 border-b border-white/10">
                        <Grid3X3 size={16} /> Blur
                    </div>
                    
                    {/* Mode Toggle */}
                    <div>
                        <div className="flex justify-between text-[10px] text-zinc-400 mb-1">
                            <span>Mode</span>
                        </div>
                        <div className="flex gap-2 bg-zinc-900/50 p-1 rounded-lg">
                            <button
                                onClick={() => handleMosaicUpdate({ mode: 'box' })}
                                className={`flex-1 py-1.5 rounded text-[10px] flex items-center justify-center gap-1 transition-all ${selectedMosaic.mode === 'box' || !selectedMosaic.mode ? 'bg-pink-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}
                            >
                                <MousePointer2 size={12} /> Box
                            </button>
                            <button
                                onClick={() => handleMosaicUpdate({ mode: 'path' })}
                                className={`flex-1 py-1.5 rounded text-[10px] flex items-center justify-center gap-1 transition-all ${selectedMosaic.mode === 'path' ? 'bg-pink-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}
                            >
                                <PenLine size={12} /> Brush
                            </button>
                        </div>
                    </div>

                    {selectedMosaic.mode === 'box' || !selectedMosaic.mode ? (
                        /* Box Mode Controls */
                        <div className="space-y-3 animate-in fade-in">
                            <div>
                                <div className="flex justify-between text-[10px] text-zinc-400 mb-1">
                                    <span>Shape</span>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleMosaicUpdate({ shape: 'rectangle' })}
                                        className={`flex-1 py-1 rounded text-xs border ${selectedMosaic.shape !== 'circle' ? 'bg-pink-600 border-pink-500' : 'bg-white/5 border-white/10 text-zinc-400'}`}
                                    >
                                        Rect
                                    </button>
                                    <button
                                        onClick={() => handleMosaicUpdate({ shape: 'circle' })}
                                        className={`flex-1 py-1 rounded text-xs border ${selectedMosaic.shape === 'circle' ? 'bg-pink-600 border-pink-500' : 'bg-white/5 border-white/10 text-zinc-400'}`}
                                    >
                                        Circle
                                    </button>
                                </div>
                            </div>
                            <div>
                                <div className="flex justify-between text-[10px] text-zinc-400 mb-1">
                                    <span>Blur Strength</span>
                                    <span>{selectedMosaic.blurAmount ?? 10}px</span>
                                </div>
                                <input
                                    type="range"
                                    min="2" max="30" step="1"
                                    value={selectedMosaic.blurAmount ?? 10}
                                    onChange={(e) => handleMosaicUpdate({ blurAmount: parseInt(e.target.value) })}
                                    className="w-full h-1 bg-zinc-600 rounded-lg appearance-none cursor-pointer accent-pink-500"
                                />
                            </div>
                        </div>
                    ) : (
                        /* Brush Mode Controls */
                        <div className="space-y-3 animate-in fade-in">
                            <div>
                                <div className="flex justify-between text-[10px] text-zinc-400 mb-1">
                                    <span>Brush Size</span>
                                    <span>{currentBrushSize}px</span>
                                </div>
                                <input
                                    type="range"
                                    min="5" max="50" step="5"
                                    value={currentBrushSize || 10}
                                    onChange={(e) => onBrushSizeChange(parseInt(e.target.value))}
                                    className="w-full h-1 bg-zinc-600 rounded-lg appearance-none cursor-pointer accent-pink-500"
                                />
                            </div>
                            <div className="text-[10px] text-zinc-500 italic border-t border-white/5 pt-2">
                                Click and drag on the video to freehand blur.
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default PropertyHUD;
