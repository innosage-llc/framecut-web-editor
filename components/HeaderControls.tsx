
import React, { useRef, useState } from 'react';
import { Download, FileAudio, Image as ImageIcon, Camera, Upload, Trash2, ChevronDown, Save, FolderOpen, RefreshCcw, Cloud, CloudOff } from 'lucide-react';

interface HeaderControlsProps {
    hasClips: boolean;
    coverImage: string | null;
    isSaving?: boolean;
    lastSaved?: Date | null;
    onCaptureCover: () => void;
    onSetCover: (url: string | null) => void;
    onExport: (audioOnly: boolean, format?: 'mp4' | 'webm' | 'wav' | 'm4a') => void;
    onExportProject: () => void;
    onImportProject: (file: File) => void;
    onResetProject: () => void;
    onManualSave: () => void; // New Prop
}

const HeaderControls: React.FC<HeaderControlsProps> = ({
    hasClips,
    coverImage,
    isSaving,
    lastSaved,
    onCaptureCover,
    onSetCover,
    onExport,
    onExportProject,
    onImportProject,
    onResetProject,
    onManualSave
}) => {
    const [showCoverMenu, setShowCoverMenu] = useState(false);
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [showProjectMenu, setShowProjectMenu] = useState(false);
    const coverInputRef = useRef<HTMLInputElement>(null);
    const projectInputRef = useRef<HTMLInputElement>(null);

    const handleUploadCover = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (evt) => {
                if (evt.target?.result) {
                    onSetCover(evt.target.result as string);
                    setShowCoverMenu(false);
                }
            };
            reader.readAsDataURL(file);
        }
    };

    const handleProjectImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            onImportProject(e.target.files[0]);
            setShowProjectMenu(false);
            e.target.value = ''; // Reset
        }
    };

    const handleCaptureClick = () => {
        onCaptureCover();
        setShowCoverMenu(false);
    };

    return (
        <div className="flex gap-3 items-center">
            
            {/* Manual Save Button & Status */}
            <div className="flex items-center gap-3 mr-2">
                <button
                    onClick={onManualSave}
                    disabled={isSaving}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                        isSaving 
                        ? 'bg-zinc-800 border-zinc-700 text-zinc-500 cursor-not-allowed' 
                        : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700 hover:border-zinc-600'
                    }`}
                    title="Save Project (Browser Storage)"
                >
                    {isSaving ? <RefreshCcw size={12} className="animate-spin" /> : <Save size={12} />}
                    {isSaving ? "Saving..." : "Save"}
                </button>
                {lastSaved && !isSaving && (
                    <span className="text-[10px] text-zinc-500 hidden xl:inline select-none animate-in fade-in">
                        Saved {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                )}
            </div>

            {/* Project Menu */}
            <div className="relative">
                <button
                    onClick={(e) => { e.stopPropagation(); setShowProjectMenu(!showProjectMenu); setShowCoverMenu(false); setShowExportMenu(false); }}
                    className={`px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-medium flex items-center gap-2 transition-colors border ${showProjectMenu ? 'border-zinc-600 bg-zinc-700' : 'border-zinc-700/50'}`}
                >
                    <FolderOpen size={14} />
                    Project
                    <ChevronDown size={14} className={`transition-transform duration-200 ${showProjectMenu ? 'rotate-180' : ''}`} />
                </button>
                
                {showProjectMenu && (
                    <>
                        <div className="fixed inset-0 z-[60]" onClick={() => setShowProjectMenu(false)} />
                        <div className="absolute top-full right-0 mt-2 w-48 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl z-[70] p-1 flex flex-col gap-1 animate-in fade-in zoom-in-95 duration-100">
                            <button 
                                onClick={(e) => { e.stopPropagation(); setShowProjectMenu(false); onExportProject(); }} 
                                className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-800 text-zinc-300 text-xs rounded text-left w-full"
                            >
                                <Save size={14} /> Save Project Bundle (.zip)
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); projectInputRef.current?.click(); }} className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-800 text-zinc-300 text-xs rounded text-left w-full">
                                <Upload size={14} /> Open Project File
                            </button>
                            <div className="h-px bg-zinc-800 my-1" />
                            <button 
                                onClick={(e) => { e.stopPropagation(); setShowProjectMenu(false); onResetProject(); }}
                                className="flex items-center gap-2 px-3 py-2 hover:bg-red-900/30 text-red-400 text-xs rounded text-left w-full"
                            >
                                <Trash2 size={14} /> Reset / New Project
                            </button>
                        </div>
                    </>
                )}
                <input
                    ref={projectInputRef}
                    type="file"
                    accept=".zip,.json"
                    className="hidden"
                    onChange={handleProjectImport}
                />
            </div>

            <div className="w-px h-6 bg-zinc-800" />

            {/* Cover Image Selector */}
            <div className="relative">
                <button
                    onClick={(e) => { e.stopPropagation(); setShowCoverMenu(!showCoverMenu); setShowProjectMenu(false); setShowExportMenu(false); }}
                    disabled={!hasClips}
                    className={`px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-medium flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed border ${coverImage ? 'border-blue-500/50 text-blue-400' : 'border-transparent'}`}
                    title="Set Cover Image (Thumbnail)"
                >
                    <ImageIcon size={14} />
                    {coverImage ? 'Cover Set' : 'Set Cover'}
                </button>

                {showCoverMenu && (
                    <>
                        <div className="fixed inset-0 z-[60]" onClick={() => setShowCoverMenu(false)} />
                        <div className="absolute top-full right-0 mt-2 w-48 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl z-[70] p-1 flex flex-col gap-1 animate-in fade-in zoom-in-95 duration-100">
                            <button onClick={handleCaptureClick} className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-800 text-zinc-300 text-xs rounded text-left w-full">
                                <Camera size={14} /> Use Current Frame
                            </button>
                            <button onClick={() => coverInputRef.current?.click()} className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-800 text-zinc-300 text-xs rounded text-left w-full">
                                <Upload size={14} /> Upload Image
                            </button>
                            {coverImage && (
                                <>
                                    <div className="h-px bg-zinc-800 my-1" />
                                    <div className="px-3 py-1">
                                        <div className="w-full aspect-video rounded overflow-hidden border border-zinc-700 bg-black">
                                            <img src={coverImage} alt="Cover Preview" className="w-full h-full object-cover" />
                                        </div>
                                    </div>
                                    <button onClick={() => { onSetCover(null); setShowCoverMenu(false); }} className="flex items-center gap-2 px-3 py-2 hover:bg-red-900/30 text-red-400 text-xs rounded text-left w-full">
                                        <Trash2 size={14} /> Remove Cover
                                    </button>
                                </>
                            )}
                        </div>
                    </>
                )}
                <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleUploadCover}
                />
            </div>

            {/* Video Export Dropdown */}
            <div className="relative">
                <button
                    onClick={(e) => { e.stopPropagation(); setShowExportMenu(!showExportMenu); setShowProjectMenu(false); setShowCoverMenu(false); }}
                    disabled={!hasClips}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium flex items-center gap-2 shadow-lg shadow-blue-900/20 transition-all hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                >
                    <Download size={16} /> 
                    Export
                    <ChevronDown size={14} className={`transition-transform duration-200 ${showExportMenu ? 'rotate-180' : ''}`} />
                </button>

                {showExportMenu && (
                    <>
                        <div className="fixed inset-0 z-[60]" onClick={() => setShowExportMenu(false)} />
                        <div className="absolute top-full right-0 mt-2 w-56 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl z-[70] p-1 flex flex-col gap-1 animate-in fade-in zoom-in-95 duration-100">
                             <button 
                                onClick={() => { onExport(false, 'mp4'); setShowExportMenu(false); }} 
                                className="flex flex-col gap-0.5 px-3 py-2 hover:bg-zinc-800 text-zinc-300 rounded text-left w-full"
                            >
                                <span className="text-xs font-semibold text-white flex items-center gap-2">
                                    Video (MP4) <span className="text-[9px] bg-blue-500/20 text-blue-300 px-1.5 rounded-full">Social</span>
                                </span>
                                <span className="text-[10px] text-zinc-500">Best for Instagram, TikTok, WhatsApp</span>
                            </button>
                            
                            <button 
                                onClick={() => { onExport(false, 'webm'); setShowExportMenu(false); }} 
                                className="flex flex-col gap-0.5 px-3 py-2 hover:bg-zinc-800 text-zinc-300 rounded text-left w-full"
                            >
                                <span className="text-xs font-semibold text-white">Video (WebM)</span>
                                <span className="text-[10px] text-zinc-500">Best for Web & Archive (High Quality)</span>
                            </button>

                            <div className="h-px bg-zinc-800 my-1" />
                            
                            {/* Audio Options Header */}
                            <div className="px-3 py-1 text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Audio Export</div>

                            <button 
                                onClick={() => { onExport(true, 'wav'); setShowExportMenu(false); }} 
                                className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-800 text-zinc-300 text-xs rounded text-left w-full group"
                            >
                                <FileAudio size={14} className="text-zinc-400 group-hover:text-purple-400 transition-colors" /> 
                                <span>Audio (WAV)</span>
                                <span className="text-[9px] text-zinc-600 ml-auto border border-zinc-700 px-1 rounded">Lossless</span>
                            </button>
                            
                            <button 
                                onClick={() => { onExport(true, 'm4a'); setShowExportMenu(false); }} 
                                className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-800 text-zinc-300 text-xs rounded text-left w-full group"
                            >
                                <FileAudio size={14} className="text-zinc-400 group-hover:text-purple-400 transition-colors" /> 
                                <span>Audio (M4A)</span>
                                <span className="text-[9px] text-zinc-600 ml-auto border border-zinc-700 px-1 rounded">AAC</span>
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default HeaderControls;