
import React, { useState } from 'react';
import { Upload, Trash2, Film, Music, Link, Check, X, Palette, Image as ImageIcon } from 'lucide-react';
import { MediaAsset } from '../types';

interface AssetSlotProps {
    title: string;
    icon: any;
    asset: MediaAsset | null;
    type: 'intro' | 'main' | 'outro' | 'audio';
    inputRef: React.RefObject<HTMLInputElement>;
    isAudio?: boolean;
    onImportUrl: (type: 'intro' | 'main' | 'outro' | 'audio', url: string) => Promise<void>;
    onRemove: (type: 'intro' | 'main' | 'outro' | 'audio') => void;
    onSetColor: (type: 'intro' | 'outro', color: string) => void;
    onFileSelect?: (e: React.ChangeEvent<HTMLInputElement>, existingId?: string) => void;
}

const AssetSlot: React.FC<AssetSlotProps> = ({
    title,
    icon: Icon,
    asset,
    type,
    inputRef,
    isAudio = false,
    onImportUrl,
    onRemove,
    onSetColor,
    onFileSelect
}) => {
    const [isUrlMode, setIsUrlMode] = useState(false);
    const [urlInput, setUrlInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleUrlSubmit = async () => {
        if (!urlInput.trim()) return;
        setIsLoading(true);
        try {
            await onImportUrl(type, urlInput);
            setIsUrlMode(false);
            setUrlInput('');
        } catch (e) {
            // Error handling managed by parent/hook
        } finally {
            setIsLoading(false);
        }
    };

    // Helper to render color options (Shared between empty and filled states)
    const renderColorOptions = () => (
        <div className="flex items-center justify-between px-1 mt-2 pt-2 border-t border-zinc-800/50">
            <span className="text-[10px] text-zinc-500 font-medium flex items-center gap-1">
                <Palette size={10} /> 
                {asset ? 'Change Color:' : 'Or 5s Color:'}
            </span>
            <div className="flex items-center gap-1.5">
                <button
                    onClick={() => onSetColor(type as 'intro' | 'outro', '#000000')}
                    className="w-4 h-4 rounded-full bg-black border border-zinc-700 hover:scale-110 transition-transform focus:outline-none focus:ring-1 focus:ring-blue-500"
                    title="Black"
                />
                <button
                    onClick={() => onSetColor(type as 'intro' | 'outro', '#ffffff')}
                    className="w-4 h-4 rounded-full bg-white border border-zinc-700 hover:scale-110 transition-transform focus:outline-none focus:ring-1 focus:ring-blue-500"
                    title="White"
                />
                <div className="relative w-4 h-4 overflow-hidden rounded-full border border-zinc-700 hover:scale-110 transition-transform cursor-pointer group/color" title="Custom Color">
                    <input
                        type="color"
                        className="absolute -top-2 -left-2 w-8 h-8 cursor-pointer p-0 opacity-0"
                        onChange={(e) => onSetColor(type as 'intro' | 'outro', e.target.value)}
                    />
                    <div className="w-full h-full bg-gradient-to-br from-red-500 via-green-500 to-blue-500 pointer-events-none" />
                </div>
            </div>
        </div>
    );

    // Determine accepted file types
    // Intro/Outro: Video + Image
    // Main: Video only
    // Audio: Audio only
    const acceptTypes = isAudio 
        ? "audio/*" 
        : (type === 'main' ? "video/*" : "video/*,image/*");

    const isImage = asset?.src.startsWith('image:');
    const isColor = asset?.src.startsWith('color:');

    return (
        <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-zinc-400 text-xs font-semibold uppercase tracking-wider">
                    <Icon size={12} />
                    {title}
                </div>
                {/* URL Toggle Button (Only if no asset or audio which supports replacement) */}
                {(!asset || isAudio) && !isUrlMode && (
                    <button
                        onClick={() => setIsUrlMode(true)}
                        className="text-[10px] flex items-center gap-1 text-zinc-500 hover:text-blue-400 transition-colors"
                    >
                        <Link size={10} /> URL
                    </button>
                )}
            </div>

            {asset && !isAudio ? ( // For Video/Color/Image assets (Single slot logic for visual assets)
                <div className="group relative">
                    <div className="bg-zinc-800 rounded-lg border border-zinc-700 hover:border-zinc-600 overflow-hidden transition-colors">
                        <div className="p-3">
                            <div className="flex items-center gap-2 mb-1">
                                {isColor ? (
                                    <div className="w-4 h-4 rounded-full border border-zinc-600 shrink-0" style={{ backgroundColor: asset.src.split('color:')[1] }} />
                                ) : isImage ? (
                                    <ImageIcon size={16} className="text-pink-500 shrink-0" />
                                ) : (
                                    <Film size={16} className="text-blue-500 shrink-0" />
                                )}
                                <span className="text-sm text-zinc-200 truncate font-medium flex-1" title={asset.name}>{asset.name}</span>
                            </div>
                            
                            <div className="text-xs text-zinc-500 flex justify-between items-center">
                                <span>Duration: {asset.duration.toFixed(1)}s</span>
                            </div>
                        </div>

                        <button
                            onClick={() => onRemove(type)}
                            className="absolute top-1 right-1 p-1.5 bg-black/50 text-zinc-400 hover:text-red-400 hover:bg-black/80 rounded opacity-0 group-hover:opacity-100 transition-all"
                            title="Remove"
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>
                    {/* Always show color picker for intro/outro to allow live switching */}
                    {(type === 'intro' || type === 'outro') && renderColorOptions()}
                </div>
            ) : isAudio ? ( // Special handling for audio
                <div className="space-y-2">
                    {asset && (
                        <div className="group relative bg-zinc-800 rounded-lg border border-zinc-700 hover:border-zinc-600 overflow-hidden transition-colors mb-2">
                            <div className="p-3">
                                <div className="flex items-center gap-2 mb-1">
                                    <Music size={16} className="text-purple-500 shrink-0" />
                                    <span className="text-sm text-zinc-200 truncate font-medium flex-1" title={asset.name}>{asset.name}</span>
                                </div>
                                <div className="text-xs text-zinc-500 flex justify-between items-center">
                                    <span>Duration: {asset.duration.toFixed(1)}s</span>
                                </div>
                            </div>
                            <button
                                onClick={() => onRemove(type)}
                                className="absolute top-1 right-1 p-1.5 bg-black/50 text-zinc-400 hover:text-red-400 hover:bg-black/80 rounded opacity-0 group-hover:opacity-100 transition-all"
                                title="Remove"
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                    )}

                    {!asset && !isUrlMode && (
                        <div
                            onClick={() => inputRef.current?.click()}
                            className="border-2 border-dashed border-zinc-800 rounded-lg p-3 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-zinc-800/50 hover:border-zinc-700 transition-all group h-20"
                        >
                            <Upload size={16} className="text-zinc-600 group-hover:text-zinc-400 mb-1" />
                            <span className="text-[10px] text-zinc-500 group-hover:text-zinc-400">Upload Audio</span>
                        </div>
                    )}
                </div>
            ) : (
                // Empty State or URL Mode
                <>
                    {isUrlMode ? (
                        <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-2 animate-in fade-in slide-in-from-top-2 duration-200">
                            <div className="flex items-center gap-2 mb-2">
                                <input
                                    type="text"
                                    value={urlInput}
                                    onChange={(e) => setUrlInput(e.target.value)}
                                    placeholder="https://..."
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none placeholder-zinc-600"
                                    onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
                                    autoFocus
                                />
                            </div>
                            <div className="flex gap-2 justify-end">
                                <button
                                    onClick={() => setIsUrlMode(false)}
                                    className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded transition-colors"
                                    title="Cancel"
                                >
                                    <X size={12} />
                                </button>
                                <button
                                    onClick={handleUrlSubmit}
                                    disabled={isLoading || !urlInput.trim()}
                                    className="flex items-center gap-1 px-2 py-1 bg-blue-600 text-white text-[10px] font-medium rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    {isLoading ? '...' : <><Check size={10} /> Load</>}
                                </button>
                            </div>
                            <div className="mt-2 text-[9px] text-zinc-500">
                                * Must support CORS (e.g. direct mp4 link)
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <div
                                onClick={() => inputRef.current?.click()}
                                className="border-2 border-dashed border-zinc-800 rounded-lg p-4 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-zinc-800/50 hover:border-zinc-700 transition-all group h-24 relative"
                            >
                                <Upload size={20} className="text-zinc-600 group-hover:text-zinc-400 mb-2" />
                                <span className="text-xs text-zinc-500 group-hover:text-zinc-400">
                                    Upload {type === 'main' ? 'Video' : 'Media'}
                                </span>
                                {type !== 'main' && type !== 'audio' && <span className="text-[9px] text-zinc-600 block mt-1">(Video or Image)</span>}
                            </div>

                            {type !== 'main' && (
                                renderColorOptions()
                            )}
                        </div>
                    )}
                </>
            )}

            <input
                ref={inputRef}
                type="file"
                accept={acceptTypes}
                className="hidden"
                onChange={(e) => {
                    if (onFileSelect) {
                        onFileSelect(e);
                    }
                }}
            />
        </div>
    );
};

export default AssetSlot;
