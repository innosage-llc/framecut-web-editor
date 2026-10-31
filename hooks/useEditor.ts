import type React from 'react';

import { useState, useCallback, useRef, useEffect } from 'react';
import { DEFAULT_BACKGROUND_FRAME, normalizeBackgroundFrame } from '../utils/backgroundFrame';
import { ExtendedEditorState, Clip, Subtitle, ZoomEffect, SpotlightEffect, MosaicEffect } from '../types';
import { generateId } from '../utils';
import { useHistory } from './useHistory';
import { linkedCompanions } from '../utils/linkedRecordingClips';
import type { AudioRole } from '../types';
import { useClipOperations, resolveLinkedSelection } from './useClipOperations';

type ProjectState = Pick<ExtendedEditorState, 'intro' | 'mainVideo' | 'outro' | 'audio' | 'narration' | 'duration' | 'clips' | 'audioClips' | 'narrationClips' | 'mutedAudioRoles' | 'subtitles' | 'zoomEffects' | 'spotlightEffects' | 'mosaicEffects' | 'selection' | 'fileName' | 'isAudioTrackMuted' | 'coverImage' | 'recordingEvents' | 'canvasBackgroundColor' | 'backgroundFrame' | 'aspectRatio' | 'autoZoomEnabled' | 'autoZoomSensitivity' | 'clickRipplesEnabled'>;

// 定义存储键名 (必须与 useProjectPersistence 保持一致)
const STORAGE_KEY = 'framecut-project-v1';

/** Media asset keys whose saved `src` is a blob URL from the previous page (restored from IndexedDB later). */
export const PERSISTED_ASSET_KEYS = ['intro', 'mainVideo', 'outro', 'audio', 'narration'] as const;

/**
 * A saved project's blob: URLs died with the page that created them. Clear them from the initial
 * state so no element requests them (ERR_FILE_NOT_FOUND); useProjectPersistence then restores the
 * media from IndexedDB with fresh URLs.
 */
export const withoutStaleBlobUrls = (parsed: any) => {
    if (!parsed || typeof parsed !== 'object') return parsed;
    const out = { ...parsed };
    for (const key of PERSISTED_ASSET_KEYS) {
        const a = out[key];
        if (a && typeof a.src === 'string' && a.src.startsWith('blob:')) out[key] = { ...a, src: '' };
    }
    return out;
};
const PENDING_RESET_KEY = 'PENDING_RESET';

// 提取默认状态，方便复用和重置
const defaultState: ExtendedEditorState = {
    intro: null,
    mainVideo: null,
    outro: null,
    audio: null,
    narration: null,
    duration: 0,
    currentTime: 0,
    isPlaying: false,
    playbackRate: 1,
    zoomLevel: 50,
    fileName: null,
    showDebug: false,
    canvasBackgroundColor: '#000000',
    aspectRatio: 16 / 9,
    backgroundFrame: DEFAULT_BACKGROUND_FRAME,
    clips: [],
    audioClips: [],
    narrationClips: [],
    mutedAudioRoles: [],
    subtitles: [],
    zoomEffects: [],
    spotlightEffects: [],
    mosaicEffects: [],
    selection: null,
    recordingEvents: [],
    autoZoomEnabled: true,
    autoZoomSensitivity: 0.5,
    clickRipplesEnabled: true,
    isExporting: false,
    isExportingAudio: false,
    isPolishing: false,
    currentBrushSize: 10,
    exportProgress: 0,
    showSuccessToast: false,
    toastMessage: null,
    isAudioTrackMuted: false,
    coverImage: null
};

export const useEditor = () => {
    // 【核心修复】使用初始化函数来加载状态
    const [state, setRawState] = useState<ExtendedEditorState>(() => {
        // 1. 安全检查：如果正在等待重置，强制返回空状态
        if (localStorage.getItem(PENDING_RESET_KEY) === 'true') {
            console.log("useEditor: 检测到重置标记，跳过本地缓存加载");
            return defaultState;
        }

        // 2. 尝试从 LocalStorage 读取上次保存的项目
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = withoutStaleBlobUrls(JSON.parse(saved));
                return { 
                    ...defaultState, 
                    ...parsed,
                    aspectRatio: parsed.aspectRatio || defaultState.aspectRatio,
                    canvasBackgroundColor: parsed.canvasBackgroundColor || defaultState.canvasBackgroundColor,
                    backgroundFrame: normalizeBackgroundFrame(parsed.backgroundFrame)
                };
            }
        } catch (e) {
            console.error("useEditor: 读取缓存失败，使用默认状态", e);
        }

        // 3. 如果没有缓存，返回默认状态
        return defaultState;
    });

    // #28: every edit that changes the screen clips (trim, split, move, delete, speed, ripple,
    // Magic Edit…) also re-times linked narration clips. Updates that replace narrationClips
    // themselves (undo/redo, project load, import) are left as they are.
    const setState = useCallback<React.Dispatch<React.SetStateAction<ExtendedEditorState>>>((action) => {
        setRawState(prev => {
            const next = typeof action === 'function' ? (action as (p: ExtendedEditorState) => ExtendedEditorState)(prev) : action;
            if (next === prev || next.clips === prev.clips) return next;
            const narration = prev.narrationClips ?? [];
            if (narration.length === 0 || next.narrationClips !== prev.narrationClips) return next;
            const updated = linkedCompanions(prev.clips, next.clips, narration);
            return updated === narration ? next : { ...next, narrationClips: updated };
        });
    }, []);

    const stateRef = useRef(state);
    useEffect(() => { stateRef.current = state; }, [state]);

    // Loop Control Refs
    const currentTimeRef = useRef(state.currentTime);
    const isPlayingRef = useRef(state.isPlaying);
    const animationFrameRef = useRef<number | null>(null);
    const lastTimeRef = useRef<number>(performance.now());
    
    // Performance: Remove UI update throttling logic entirely as we stop setState loop
    // const lastUiUpdateRef = useRef<number>(0); 

    const { push, undo, redo } = useHistory<ProjectState>();

    const recalculateDuration = useCallback((
        clips: Clip[],
        audioClips: Clip[],
        subtitles: Subtitle[],
        zoomEffects: ZoomEffect[],
        spotlightEffects: SpotlightEffect[],
        mosaicEffects: MosaicEffect[]
    ): number => {
        const lastClipEnd = clips.reduce((max, c) => {
            const duration = (c.sourceEnd - c.sourceStart) / c.speed;
            return Math.max(max, c.offset + duration);
        }, 0);

        const lastAudioEnd = audioClips.reduce((max, c) => {
            const duration = (c.sourceEnd - c.sourceStart) / c.speed;
            return Math.max(max, c.offset + duration);
        }, 0);

        const lastSubEnd = subtitles.reduce((max, s) => Math.max(max, s.end), 0);
        const lastZoomEnd = zoomEffects.reduce((max, z) => Math.max(max, z.end), 0);
        const lastSpotEnd = spotlightEffects.reduce((max, s) => Math.max(max, s.end), 0);
        const lastMosEnd = mosaicEffects.reduce((max, m) => Math.max(max, m.end), 0);

        let total = Math.max(lastClipEnd, lastAudioEnd, lastSubEnd, lastZoomEnd, lastSpotEnd, lastMosEnd);
        if (clips.length === 0 && audioClips.length === 0 && total === 0) total = 0;
        return total;
    }, []);

    const getProjectState = (fullState: ExtendedEditorState): ProjectState => ({
        intro: fullState.intro,
        mainVideo: fullState.mainVideo,
        outro: fullState.outro,
        audio: fullState.audio,
        narration: fullState.narration ?? null,
        duration: fullState.duration,
        clips: fullState.clips,
        audioClips: fullState.audioClips,
        narrationClips: fullState.narrationClips ?? [],
        mutedAudioRoles: fullState.mutedAudioRoles ?? [],
        subtitles: fullState.subtitles,
        zoomEffects: fullState.zoomEffects,
        spotlightEffects: fullState.spotlightEffects,
        mosaicEffects: fullState.mosaicEffects,
        selection: fullState.selection,
        fileName: fullState.fileName,
        isAudioTrackMuted: fullState.isAudioTrackMuted,
        coverImage: fullState.coverImage,
        recordingEvents: fullState.recordingEvents,
        canvasBackgroundColor: fullState.canvasBackgroundColor,
        backgroundFrame: fullState.backgroundFrame,
        aspectRatio: fullState.aspectRatio,
        autoZoomEnabled: fullState.autoZoomEnabled,
        autoZoomSensitivity: fullState.autoZoomSensitivity,
        clickRipplesEnabled: fullState.clickRipplesEnabled
    });

    const pushHistory = useCallback(() => {
        const currentProjectState = getProjectState(stateRef.current);
        push(currentProjectState);
    }, [push]);

    const handleUndo = useCallback(() => {
        const current = getProjectState(stateRef.current);
        const previous = undo(current);
        if (previous) {
            setState(prev => ({ ...prev, ...previous }));
            currentTimeRef.current = stateRef.current.currentTime;
        }
    }, [undo]);

    const handleRedo = useCallback(() => {
        const current = getProjectState(stateRef.current);
        const next = redo(current);
        if (next) {
            setState(prev => ({ ...prev, ...next }));
            currentTimeRef.current = stateRef.current.currentTime;
        }
    }, [redo]);

    const {
        handleDelete,
        handleSplit,
        handleCrop,
        handleToggleNarrationClipMute,
        handleUpdateClip,
        handleUpdateSubtitle,
        handleUpdateZoomEffect,
        handleUpdateSpotlightEffect,
        handleUpdateMosaicEffect,
        handleAddSubtitle,
        handleAddZoom,
        handleAddSpotlight,
        handleAddMosaic
    } = useClipOperations({ setState, pushHistory, recalculateDuration });

    const handleSeek = useCallback((time: number) => {
        currentTimeRef.current = time;
        setState(prev => ({ ...prev, currentTime: time }));
    }, []);

    // DIRECT-DRIVE PLAYBACK LOOP (Optimized for Performance)
    useEffect(() => {
        if (state.isPlaying) {
            lastTimeRef.current = performance.now();
            isPlayingRef.current = true;

            const loop = (timestamp: number) => {
                if (!isPlayingRef.current) return;

                const delta = (timestamp - lastTimeRef.current) / 1000;
                lastTimeRef.current = timestamp;

                const { duration, playbackRate, isExporting, exportProgress } = stateRef.current;

                // Determine Time
                let newTime = currentTimeRef.current + delta * playbackRate;
                let newProgress = exportProgress;

                if (isExporting) {
                    newProgress = Math.min(100, Math.floor((newTime / duration) * 100));
                }

                if (duration > 0 && newTime >= duration) {
                    if (isExporting) {
                        isPlayingRef.current = false;
                        newTime = duration;
                        newProgress = 100;
                    } else {
                        newTime = 0;
                    }
                }

                // 1. High-Frequency Update: REFS ONLY
                // This drives the Canvas Player, Timeline Playhead, and Toolbar Clock via RAF
                currentTimeRef.current = newTime;

                // 2. State Update Logic
                // PERFORMANCE FIX: Do NOT call setState during normal playback.
                // React re-renders are too expensive (10-20ms) for a 60fps loop (16ms).
                // We only sync state when:
                // a) Exporting (need progress bar update)
                // b) Playback stops (to sync final UI state)
                
                if (isExporting) {
                    // Export requires UI updates for progress bar, throttled
                    setState(prev => ({
                        ...prev,
                        currentTime: newTime,
                        exportProgress: newProgress,
                        isPlaying: isPlayingRef.current ? prev.isPlaying : false
                    }));
                } else if (!isPlayingRef.current) {
                    // Playback finished/looped
                    setState(prev => ({
                        ...prev,
                        currentTime: newTime,
                        isPlaying: false
                    }));
                }

                if (isPlayingRef.current) {
                    animationFrameRef.current = requestAnimationFrame(loop);
                }
            };

            animationFrameRef.current = requestAnimationFrame(loop);
        } else {
            isPlayingRef.current = false;
            // Sync React state to Ref when pausing to ensure consistency
            setState(prev => ({ ...prev, currentTime: currentTimeRef.current }));
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        }
        return () => {
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        };
    }, [state.isPlaying]);

    const handleDetachAudio = useCallback(() => {
        pushHistory();
        setState(prev => {
            if (prev.selection?.type !== 'clip') return prev;
            const clipId = prev.selection.id;
            const videoClip = prev.clips.find(c => c.id === clipId);
            if (!videoClip) return prev;
            const newAudioClip: Clip = { ...videoClip, id: generateId(), muted: false, recordingLinkID: undefined }; // #28: detached system audio is independent of the recording link
            const updatedVideoClips = prev.clips.map(c => c.id === clipId ? { ...c, muted: true } : c);
            const updatedAudioClips = [...prev.audioClips, newAudioClip];
            return { ...prev, clips: updatedVideoClips, audioClips: updatedAudioClips, selection: { type: 'audio', id: newAudioClip.id }, duration: recalculateDuration(updatedVideoClips, updatedAudioClips, prev.subtitles, prev.zoomEffects, prev.spotlightEffects, prev.mosaicEffects) };
        });
    }, [pushHistory, recalculateDuration]);

    const handleZoomScaleChange = useCallback((scale: number) => {
        pushHistory();
        setState(prev => {
            if (prev.selection?.type !== 'zoom') return prev;
            const zoom = prev.zoomEffects.find(z => z.id === prev.selection!.id);
            if (!zoom) return prev;
            const newSize = 100 / scale;
            const centerX = zoom.x + zoom.width / 2;
            const centerY = zoom.y + zoom.height / 2;
            const newWidth = newSize;
            const newHeight = newSize;
            return {
                ...prev,
                zoomEffects: prev.zoomEffects.map(z => z.id === zoom.id ? {
                    ...z,
                    width: newWidth,
                    height: newHeight,
                    x: centerX - newWidth / 2,
                    y: centerY - newHeight / 2
                } : z)
            };
        });
    }, [pushHistory]);

    const handleMosaicBrushSizeChange = useCallback((size: number) => {
        setState(prev => ({ ...prev, currentBrushSize: size }));
    }, []);

    const handleClipSpeedChange = useCallback((speed: number) => {
        // #28: a narration selection changes the speed of its linked screen clip (the narration
        // follows via recordingLinkID). Nothing to change → no undo step.
        const cur = resolveLinkedSelection(stateRef.current);
        const sel = cur.selection;
        if (!sel || (sel.type !== 'clip' && sel.type !== 'audio')) return;
        const target = (sel.type === 'audio' ? cur.audioClips : cur.clips).find(c => c.id === sel.id);
        if (!target || target.speed === speed) return;
        pushHistory();
        setState(original => {
            const prev = resolveLinkedSelection(original);
            const { selection, clips, audioClips } = prev;
            if (!selection || (selection.type !== 'clip' && selection.type !== 'audio')) return original;
            const isAudio = selection.type === 'audio';
            const targetClips = isAudio ? audioClips : clips;
            const targetId = selection.id;
            const clipIndex = targetClips.findIndex(c => c.id === targetId);
            if (clipIndex === -1) return original;
            const clip = targetClips[clipIndex];
            const oldDuration = (clip.sourceEnd - clip.sourceStart) / clip.speed;
            const newDuration = (clip.sourceEnd - clip.sourceStart) / speed;
            const durationDelta = newDuration - oldDuration;
            const newTrackClips = [...targetClips];
            newTrackClips[clipIndex] = { ...clip, speed };
            for (let i = clipIndex + 1; i < newTrackClips.length; i++) {
                newTrackClips[i] = {
                    ...newTrackClips[i],
                    offset: newTrackClips[i].offset + durationDelta
                };
            }
            const newClips = isAudio ? clips : newTrackClips;
            const newAudioClips = isAudio ? newTrackClips : audioClips;
            return {
                ...original,
                clips: newClips,
                audioClips: newAudioClips,
                duration: recalculateDuration(newClips, newAudioClips, prev.subtitles, prev.zoomEffects, prev.spotlightEffects, prev.mosaicEffects)
            };
        });
    }, [pushHistory, recalculateDuration]);

    const handleToggleDebug = useCallback(() => {
        setState(prev => ({ ...prev, showDebug: !prev.showDebug }));
    }, []);

    const handleSetCoverImage = useCallback((url: string | null) => {
        setState(prev => ({ ...prev, coverImage: url }));
    }, []);

    const handleUpdateProjectSettings = useCallback((updates: Partial<ExtendedEditorState>) => {
        setState(prev => ({ ...prev, ...updates }));
    }, []);

    /** #28: A1/A2/A3 lane mute; persisted and one undo step. Music mirrors the legacy audio-track mute. */
    const handleSetAudioRoleMuted = useCallback((role: AudioRole, muted: boolean) => {
        pushHistory();
        setState(prev => {
            const roles = new Set<AudioRole>(prev.mutedAudioRoles ?? []);
            if (role === 'music' && prev.isAudioTrackMuted) roles.add('music');
            if (muted) roles.add(role); else roles.delete(role);
            return { ...prev, mutedAudioRoles: (['system', 'narration', 'music'] as AudioRole[]).filter(r => roles.has(r)), isAudioTrackMuted: roles.has('music') };
        });
    }, [pushHistory, setState]);

    return {
        state,
        setState,
        handleSetAudioRoleMuted,
        stateRef,
        pushHistory,
        handleUndo,
        handleRedo,
        recalculateDuration,
        handleDelete,
        handleSplit,
        handleCrop,
        handleToggleNarrationClipMute,
        handleUpdateClip,
        handleUpdateSubtitle,
        handleUpdateZoomEffect,
        handleUpdateSpotlightEffect,
        handleUpdateMosaicEffect,
        handleDetachAudio,
        handleAddSubtitle,
        handleAddZoom,
        handleAddSpotlight,
        handleAddMosaic,
        handleZoomScaleChange,
        handleMosaicBrushSizeChange,
        handleClipSpeedChange,
        handleToggleDebug,
        handleSeek,
        handleSetCoverImage,
        handleUpdateProjectSettings,
        currentTimeRef,
        isPlayingRef
    };
};
