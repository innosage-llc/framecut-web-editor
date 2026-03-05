
import React, { useEffect, useCallback, useState, useRef } from 'react';
import JSZip from 'jszip';
import { ExtendedEditorState, EditorState, MediaAsset } from '../types';
import { generateId, extractWaveform } from '../utils';
import { getAssetFromDB, clearAssetsDB, storeAssetInDB } from '../utils/db';

// 定义 LocalStorage 的键名
const STORAGE_KEY = 'framecut-project-v1';
const PENDING_RESET_KEY = 'PENDING_RESET';

interface UseProjectPersistenceProps {
    state: ExtendedEditorState;
    setState: React.Dispatch<React.SetStateAction<ExtendedEditorState>>;
    recalculateDuration: (
        clips: any[], audioClips: any[], subtitles: any[], zoomEffects: any[], spotlightEffects: any[], mosaicEffects: any[]
    ) => number;
}

export const useProjectPersistence = ({ state, setState, recalculateDuration }: UseProjectPersistenceProps) => {
    const [lastSaved, setLastSaved] = useState<Date | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    
    // UI State for the spinner overlay (Resetting)
    const [isResetting, setIsResetting] = useState(false);
    
    // Ref 用于在闭包中同步阻断自动保存
    const isResettingRef = useRef(false);

    // ------------------------------------------------------------------
    // 1. 【核心修复】初始化时的重置检查 (The Cleaner)
    // ------------------------------------------------------------------
    useEffect(() => {
        const checkPendingReset = async () => {
            // 直接读取 LocalStorage，这是最可靠的标志
            const shouldReset = localStorage.getItem(PENDING_RESET_KEY);
            
            if (shouldReset === 'true') {
                console.log("🔄 检测到重置标记，开始清理环境...");
                
                // 锁定状态，显示 Spinner
                setIsResetting(true);
                isResettingRef.current = true;

                try {
                    // 1. 彻底清空 IndexedDB (包括存视频 Blob 的表)
                    await clearAssetsDB();
                    
                    // 2. 清空 LocalStorage 里的项目 JSON
                    localStorage.removeItem(STORAGE_KEY);
                    
                    // 3. 移除重置标记
                    localStorage.removeItem(PENDING_RESET_KEY);
                    
                    console.log("✅ 清理完成，执行二次刷新以重置内存...");
                    
                    // 4. 【关键】再次刷新页面
                    // 确保 React 内存中的所有状态、Blob URL、AudioContext 全部被浏览器回收
                    window.location.reload();
                    
                } catch (e) {
                    console.error("❌ 重置清理失败:", e);
                    // 即使失败也要移除标记，防止无限循环死机
                    localStorage.removeItem(PENDING_RESET_KEY);
                    alert("重置遇到问题，请手动清除浏览器缓存。");
                    setIsResetting(false);
                }
            }
        };

        checkPendingReset();
    }, []);

    // ------------------------------------------------------------------
    // 2. 状态净化 (过滤掉不需要保存的运行时状态)
    // ------------------------------------------------------------------
    const sanitizeState = (fullState: ExtendedEditorState): Partial<ExtendedEditorState> => {
        const {
            isPlaying,
            isExporting,
            isExportingAudio,
            exportProgress,
            showSuccessToast,
            selection,
            showDebug,
            ...persistentState
        } = fullState;

        // 去除波形数据以减少 JSON 体积 (加载时会重新生成)
        const stripWaveform = (asset: any) => {
            if (!asset) return null;
            const { waveformData, ...rest } = asset;
            return rest;
        };

        return {
            ...persistentState,
            intro: stripWaveform(persistentState.intro),
            mainVideo: stripWaveform(persistentState.mainVideo),
            outro: stripWaveform(persistentState.outro),
            audio: stripWaveform(persistentState.audio),
            currentTime: 0, 
            zoomLevel: persistentState.zoomLevel || 50
        };
    };

    // ------------------------------------------------------------------
    // 3. 手动保存逻辑 (Manual Save) - REPLACED AUTO-SAVE
    // ------------------------------------------------------------------
    const saveProject = useCallback(() => {
        if (isResettingRef.current || localStorage.getItem(PENDING_RESET_KEY) === 'true') return;
        if (state.isExporting) return;

        setIsSaving(true);

        // 使用 setTimeout 让 UI 有机会先渲染 "Saving..." 状态，避免卡顿感
        setTimeout(() => {
            try {
                const data = JSON.stringify(sanitizeState(state));
                
                if (!isResettingRef.current) {
                    localStorage.setItem(STORAGE_KEY, data);
                    setLastSaved(new Date());
                }
            } catch (e) {
                console.error("Manual save failed (likely quota exceeded)", e);
                alert("保存失败：可能是浏览器存储空间不足。建议使用 'Project > Save Project Bundle' 下载备份。");
            } finally {
                if (!isResettingRef.current) {
                    setIsSaving(false);
                }
            }
        }, 10);
    }, [state]);

    // Add safety warning for closing tab
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            // Simple heuristic: If we have content, prompt user.
            // Ideally we check isDirty, but for performance we just warn if project exists.
            if (state.clips.length > 0 || state.audioClips.length > 0) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [state.clips.length, state.audioClips.length]);


    // ------------------------------------------------------------------
    // 4. 加载项目逻辑 (Load Project)
    // ------------------------------------------------------------------
    useEffect(() => {
        const loadSavedProject = async () => {
            // 如果正在等待重置，直接跳过加载逻辑
            if (localStorage.getItem(PENDING_RESET_KEY) === 'true') {
                return; 
            }

            if (isResettingRef.current) return;

            const saved = localStorage.getItem(STORAGE_KEY);
            if (!saved) return;

            try {
                const parsed = JSON.parse(saved);
                if (!parsed.clips) return;

                // 辅助函数：从 IndexedDB 恢复 Blob URL
                const restoreAsset = async (asset: MediaAsset | null): Promise<MediaAsset | null> => {
                    if (!asset) return null;
                    // 如果是纯色背景，跳过
                    if (asset.src && (asset.src.startsWith('color:') || asset.src.startsWith('image:'))) return asset;
                    
                    // 如果有 storageId，尝试从 IndexedDB 捞回 Blob
                    if (asset.storageId) {
                        try {
                            const blob = await getAssetFromDB(asset.storageId);
                            if (blob) {
                                // 重建 Blob URL
                                const newUrl = URL.createObjectURL(blob);
                                // 重新计算波形
                                const waveformData = await extractWaveform(newUrl);
                                return { ...asset, src: newUrl, waveformData };
                            }
                        } catch (e) {
                            console.warn(`Failed to restore asset ${asset.name} from DB`, e);
                        }
                    }
                    return asset; 
                };

                // 并行恢复所有资源的 Blob URL
                const restoredIntro = await restoreAsset(parsed.intro);
                const restoredMain = await restoreAsset(parsed.mainVideo);
                const restoredOutro = await restoreAsset(parsed.outro);
                const restoredAudio = await restoreAsset(parsed.audio);

                if (isResettingRef.current) return;

                setState(prev => ({
                    ...prev,
                    ...parsed,
                    intro: restoredIntro,
                    mainVideo: restoredMain,
                    outro: restoredOutro,
                    audio: restoredAudio,
                    isPlaying: false,
                    isExporting: false,
                    selection: null
                }));
                
                // Set initial saved time if loaded successfully
                // We use current time to indicate "synced with storage"
                setLastSaved(new Date());

            } catch (e) {
                console.error("Failed to load saved project", e);
            }
        };

        loadSavedProject();
    }, [setState]);

    // ------------------------------------------------------------------
    // 5. 导出项目包 (Zip Export)
    // ------------------------------------------------------------------
    const handleExportProject = useCallback(async () => {
        if (isResettingRef.current) return;
        
        try {
            setIsSaving(true);
            const zip = new JSZip();
            const assetsFolder = zip.folder("assets");
            
            const cleanState = sanitizeState(state);
            const stateToSave = JSON.parse(JSON.stringify(cleanState)); 

            const getExtension = (blob: Blob, name: string) => {
                const type = blob.type;
                if (type.includes('webm')) return 'webm';
                if (type.includes('mp4')) return 'mp4';
                if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
                if (type.includes('wav')) return 'wav';
                if (type.includes('ogg')) return 'ogg';
                if (type.includes('png')) return 'png';
                if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
                const ext = name.split('.').pop();
                return ext && ext.length < 5 ? ext : 'bin';
            };

            const processAsset = async (asset: MediaAsset | null | undefined): Promise<MediaAsset | null> => {
                if (!asset || !assetsFolder) return null;
                if (asset.src.startsWith('color:')) return asset;

                let blob: Blob | null = null;

                if (asset.storageId) {
                    try {
                        blob = await getAssetFromDB(asset.storageId);
                    } catch (e) {
                        console.warn("DB retrieval failed for packaging", e);
                    }
                }

                if (!blob) {
                    try {
                        const res = await fetch(asset.src);
                        if (res.ok) blob = await res.blob();
                    } catch (e) {
                        console.warn(`Failed to fetch asset ${asset.name} for packaging`, e);
                    }
                }

                if (blob) {
                    const ext = getExtension(blob, asset.name);
                    const filename = `${asset.id}.${ext}`;
                    assetsFolder.file(filename, blob);
                    
                    // 在 JSON 里只保存相对路径
                    return { ...asset, src: `assets/${filename}`, storageId: undefined, waveformData: undefined };
                } else {
                    // Check for potential data loss
                    if (asset.src.startsWith('blob:')) {
                        console.error(`CRITICAL: Failed to retrieve blob data for local asset: ${asset.name}. This asset will be missing in the export.`);
                        alert(`Warning: Could not package asset "${asset.name}". The exported project will be incomplete.`);
                    }
                }

                return asset;
            };

            stateToSave.intro = await processAsset(stateToSave.intro);
            stateToSave.mainVideo = await processAsset(stateToSave.mainVideo);
            stateToSave.outro = await processAsset(stateToSave.outro);
            stateToSave.audio = await processAsset(stateToSave.audio);

            zip.file("project.json", JSON.stringify(stateToSave, null, 2));

            const zipBlob = await zip.generateAsync({ type: "blob" });
            const url = URL.createObjectURL(zipBlob);
            
            const a = document.createElement('a');
            a.href = url;
            const safeName = (state.fileName || 'project').replace(/[^a-z0-9]/gi, '-').toLowerCase();
            a.download = `framecut-package-${safeName}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);

        } catch (e: any) {
            console.error("Export Project Package Failed", e);
            alert("打包项目时出错 (Export Error): " + (e.message || "Unknown Error"));
        } finally {
            setIsSaving(false);
        }
    }, [state]);

    // ------------------------------------------------------------------
    // 6. 导入项目包 (Import Zip)
    // ------------------------------------------------------------------
    const handleImportProject = useCallback((file: File) => {
        if (isResettingRef.current) return;

        const processImport = async () => {
            try {
                let projectState: any;
                const isZip = file.name.toLowerCase().endsWith('.zip');

                if (isZip) {
                    const zip = await JSZip.loadAsync(file);
                    const projectFile = zip.file("project.json");
                    if (!projectFile) throw new Error("无效的项目文件: 缺少 project.json");
                    
                    const jsonStr = await projectFile.async("string");
                    projectState = JSON.parse(jsonStr);

                    const restoreAssetFromZip = async (asset: MediaAsset | null) => {
                        if (!asset) return null;
                        if (asset.src.startsWith('assets/')) {
                            const assetFile = zip.file(asset.src);
                            if (assetFile) {
                                const blob = await assetFile.async("blob");
                                const newStorageId = generateId();
                                // 重要：导入时必须写入 IndexedDB，否则刷新页面会丢失
                                await storeAssetInDB(newStorageId, blob);
                                const newUrl = URL.createObjectURL(blob);
                                const waveformData = await extractWaveform(newUrl);
                                return { ...asset, src: newUrl, storageId: newStorageId, waveformData };
                            } else {
                                console.warn(`Asset file missing in zip: ${asset.src}`);
                            }
                        }
                        return asset;
                    };

                    projectState.intro = await restoreAssetFromZip(projectState.intro);
                    projectState.mainVideo = await restoreAssetFromZip(projectState.mainVideo);
                    projectState.outro = await restoreAssetFromZip(projectState.outro);
                    projectState.audio = await restoreAssetFromZip(projectState.audio);

                } else {
                    const text = await file.text();
                    projectState = JSON.parse(text);
                }

                if (!Array.isArray(projectState.clips)) throw new Error("项目文件格式错误");

                const duration = recalculateDuration(
                    projectState.clips, 
                    projectState.audioClips || [], 
                    projectState.subtitles || [], 
                    projectState.zoomEffects || [], 
                    projectState.spotlightEffects || [], 
                    projectState.mosaicEffects || []
                );

                setState(prev => ({
                    ...prev,
                    ...projectState,
                    duration,
                    isPlaying: false,
                    isExporting: false,
                    selection: null,
                    currentTime: 0
                }));
                
                // Save manually immediately after import so it persists
                if (!isResettingRef.current) {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeState(projectState as ExtendedEditorState)));
                    setLastSaved(new Date());
                }

                alert("项目加载成功！");

            } catch (err: any) {
                console.error("Import failed", err);
                alert("加载失败: " + err.message);
            }
        };

        processImport();
    }, [setState, recalculateDuration]);

    // ------------------------------------------------------------------
    // 7. 【终极修复】双重保险重置
    // ------------------------------------------------------------------
    const handleResetProject = useCallback(() => {
        if (window.confirm("确定要创建新项目吗？\n\n当前未保存的进度将会丢失。")) {
            // 1. 设置重置标记 (告诉 IndexedDB 清理逻辑：下一步该你了)
            localStorage.setItem(PENDING_RESET_KEY, 'true');
            
            // 2. 【关键一步】在刷新前，直接把主数据源掐断！
            // 这样页面刷新初始化 State 时，读到的就是 null，只能加载默认空状态
            localStorage.removeItem(STORAGE_KEY);
            
            // 3. 立即刷新
            window.location.reload();
        }
    }, []);

    return {
        lastSaved,
        isSaving,
        isResetting, // 暴露给 UI 用于显示全屏 Spinner
        saveProject, // EXPOSED MANUAL SAVE
        handleExportProject,
        handleImportProject,
        handleResetProject
    };
};
