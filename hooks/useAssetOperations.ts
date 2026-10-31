
import { DEFAULT_CAMERA_BUBBLE } from '../utils/cameraBubble';
import React, { Dispatch, SetStateAction, useCallback } from 'react';
import { MediaAsset, Clip, SpotlightEffect, ExtendedEditorState, RecordingEvent } from '../types';
import { generateId, getVideoDuration, extractWaveform } from '../utils';
import { storeAssetInDB, deleteAssetFromDB, getAssetFromDB } from '../utils/db';
import { generateAutoZooms, mergeAutoZooms, removeAutoZooms, hasClickMetadata } from '../utils/autoZoom';
import { generateAutoSpotlights, mergeAutoSpotlights } from '../utils/clickPolish';
import { describeMainVideoBoundWork, clearedMainVideoBoundWork } from '../utils/mainVideoWork';
import { analyzeAudioSilence, analyzeMousePatterns, generateSimulatedEffects } from '../utils/analysis';

interface UseAssetOperationsProps {
    setState: Dispatch<SetStateAction<ExtendedEditorState>>;
    pushHistory: () => void;
    recalculateDuration: (
        clips: Clip[],
        audioClips: Clip[],
        subtitles: any[],
        zoomEffects: any[],
        spotlightEffects: any[],
        mosaicEffects: any[]
    ) => number;
    currentTimeRef: React.MutableRefObject<number>;
    /** Latest editor state, used to confirm before replacing the main video would discard effects (#26). */
    stateRef?: React.MutableRefObject<ExtendedEditorState>;
}

/** #28: extra sources recorded with the screen. */
export interface RecordingImportExtras {
    narration?: { blob: Blob; timeOffset: number; duration: number };
    /** #28: camera recorded with the screen; drawn as a bubble on the screen clip. */
    camera?: { blob: Blob; timeOffset: number; duration: number };
}

export const useAssetOperations = ({ setState, pushHistory, recalculateDuration, currentTimeRef, stateRef }: UseAssetOperationsProps) => {

    /** Ask before a new (non-relink) main video wipes effects tied to the old media. Returns false if cancelled. */
    const confirmMainReplacement = (): boolean => {
        const prev = stateRef?.current;
        if (!prev || !prev.mainVideo) return true;
        const summary = describeMainVideoBoundWork(prev);
        if (!summary) return true;
        return window.confirm(`Replacing the main video will remove ${summary} made for the current video. Continue?`);
    };


    const updateStateWithAsset = (type: 'intro' | 'main' | 'outro' | 'audio', asset: MediaAsset, duration: number, isReplacement: boolean = false) => {
        setState(prev => {
            let newState = { ...prev };

            // If it's a replacement, we update the asset but DO NOT touch the timeline clips
            // because the timeline clips reference the asset ID, which we preserved.
            if (isReplacement) {
                if (type === 'intro') newState.intro = asset;
                else if (type === 'main') newState.mainVideo = asset;
                else if (type === 'outro') newState.outro = asset;
                else if (type === 'audio') newState.audio = asset;
                
                newState.duration = recalculateDuration(newState.clips, newState.audioClips, newState.subtitles, newState.zoomEffects, newState.spotlightEffects, newState.mosaicEffects);
                return newState;
            }

            // Normal "New Asset" Logic (Resets timeline for that track)
            
            // Reset cover image if replacing the main video entirely (not re-linking)
            if (type === 'main') {
                newState.coverImage = null;
                // Force reset playhead to 0 to ensure user sees the start of the new video immediately
                newState.currentTime = 0;
                currentTimeRef.current = 0;
            }

            if (type === 'audio') {
                newState.audio = asset;
                const nonAudioTypeClips = prev.audioClips.filter(c => c.mediaType !== 'audio');
                const newAudioClip: Clip = { id: generateId(), sourceStart: 0, sourceEnd: duration, offset: 0, speed: 1.0, mediaType: 'audio' };
                newState.audioClips = [...nonAudioTypeClips, newAudioClip];
            } else if (type === 'intro') {
                newState.intro = asset;
                const otherClips = prev.clips.filter(c => c.mediaType !== 'intro');
                const newIntroClip: Clip = { id: generateId(), sourceStart: 0, sourceEnd: duration, offset: 0, speed: 1.0, mediaType: 'intro' };
                otherClips.sort((a, b) => a.offset - b.offset);
                let currentOffset = duration;
                const shiftedClips = otherClips.map(c => {
                    const dur = (c.sourceEnd - c.sourceStart) / c.speed;
                    const clip = { ...c, offset: currentOffset };
                    currentOffset += dur;
                    return clip;
                });
                newState.clips = [newIntroClip, ...shiftedClips];
            } else if (type === 'outro') {
                newState.outro = asset;
                const otherClips = prev.clips.filter(c => c.mediaType !== 'outro');
                otherClips.sort((a, b) => a.offset - b.offset);
                let currentOffset = 0;
                otherClips.forEach(c => {
                    const dur = (c.sourceEnd - c.sourceStart) / c.speed;
                    currentOffset = Math.max(currentOffset, c.offset + dur);
                });
                const newOutroClip: Clip = { id: generateId(), sourceStart: 0, sourceEnd: duration, offset: currentOffset, speed: 1.0, mediaType: 'outro' };
                newState.clips = [...otherClips, newOutroClip];
            } else if (type === 'main') {
                newState.mainVideo = asset;
                newState.fileName = asset.name;
                // Plain MP4/image import has no click metadata — clear any prior recording events (Cap parity).
                newState.recordingEvents = [];
                // Effects are timed against the old media — drop them with it (#26).
                Object.assign(newState, clearedMainVideoBoundWork());
                const introClips = prev.clips.filter(c => c.mediaType === 'intro');
                const outroClips = prev.clips.filter(c => c.mediaType === 'outro');
                const newMainClip: Clip = { id: generateId(), sourceStart: 0, sourceEnd: duration, offset: 0, speed: 1.0, mediaType: 'main' };
                introClips.sort((a, b) => a.offset - b.offset);
                let currentOffset = 0;
                const finalIntroClips = introClips.map(c => {
                    const dur = (c.sourceEnd - c.sourceStart) / c.speed;
                    const clip = { ...c, offset: currentOffset };
                    currentOffset += dur;
                    return clip;
                });
                newMainClip.offset = currentOffset;
                currentOffset += (newMainClip.sourceEnd - newMainClip.sourceStart);
                outroClips.sort((a, b) => a.offset - b.offset);
                const finalOutroClips = outroClips.map(c => {
                    const dur = (c.sourceEnd - c.sourceStart) / c.speed;
                    const clip = { ...c, offset: currentOffset };
                    currentOffset += dur;
                    return clip;
                });
                newState.clips = [...finalIntroClips, newMainClip, ...finalOutroClips];
            }
            newState.duration = recalculateDuration(newState.clips, newState.audioClips, newState.subtitles, newState.zoomEffects, newState.spotlightEffects, newState.mosaicEffects);
            return newState;
        });
    }

    // ... (handleMagicPolish kept as is, omitted for brevity as it is unchanged) ...
    const handleMagicPolish = useCallback(async (currentMainVideo: MediaAsset | null, recordingEvents: RecordingEvent[]) => {
        // ... (existing logic)
        if (!currentMainVideo) {
            alert("No Main Video found to polish.");
            return;
        }

        pushHistory();
        setState(prev => ({ ...prev, isPolishing: true }));

        try {
            let blob: Blob | null = null;
            if (currentMainVideo.storageId) {
                blob = await getAssetFromDB(currentMainVideo.storageId);
            }
            if (!blob && currentMainVideo.src) {
                try {
                    const res = await fetch(currentMainVideo.src);
                    blob = await res.blob();
                } catch (e) {
                    console.warn("Could not fetch video blob for analysis", e);
                }
            }
            if (!blob) {
                throw new Error("Could not access video data for analysis.");
            }
            console.log("Magic Polish: Detecting Silence...");
            const activeRanges = await analyzeAudioSilence(blob, currentMainVideo.duration);
            console.log("Magic Polish: Generating Effects...");
            let generatedZooms: any[] = [];
            let generatedSpotlights: any[] = [];
            let usedHeuristics = false;
            
            if (recordingEvents && recordingEvents.length > 0) {
                console.log(`Magic Polish: Analyzing ${recordingEvents.length} events for patterns.`);
                const result = analyzeMousePatterns(recordingEvents, currentMainVideo.duration);
                generatedZooms = result.zooms;
                generatedSpotlights = result.spotlights;
            } else {
                generatedZooms = [];
                generatedSpotlights = [];
            }

            setState(prev => {
                let currentOffset = 0;
                const newMainClips: Clip[] = activeRanges.map(range => {
                    const clipDuration = range.end - range.start;
                    const clip: Clip = {
                        id: generateId(),
                        sourceStart: range.start,
                        sourceEnd: range.end,
                        offset: currentOffset,
                        speed: 1.0,
                        mediaType: 'main'
                    };
                    currentOffset += clipDuration;
                    return clip;
                });

                const mapSourceToTimeline = (sourceTime: number): number | null => {
                    for (const clip of newMainClips) {
                        if (sourceTime >= clip.sourceStart && sourceTime <= clip.sourceEnd) {
                            return clip.offset + (sourceTime - clip.sourceStart);
                        }
                    }
                    return null;
                };

                const finalZooms: any[] = [];
                const finalSpotlights: any[] = [];

                generatedZooms.forEach(z => {
                    const newStart = mapSourceToTimeline(z.start);
                    const newEnd = mapSourceToTimeline(z.end);
                    if (newStart !== null && newEnd !== null && newEnd > newStart) {
                        finalZooms.push({ ...z, start: newStart, end: newEnd });
                    }
                });

                generatedSpotlights.forEach(s => {
                    const newStart = mapSourceToTimeline(s.start);
                    const newEnd = mapSourceToTimeline(s.end);
                    if (newStart !== null && newEnd !== null && newEnd > newStart) {
                        finalSpotlights.push({ ...s, start: newStart, end: newEnd });
                    }
                });

                const introClips = prev.clips.filter(c => c.mediaType === 'intro');
                const outroClips = prev.clips.filter(c => c.mediaType === 'outro');
                
                let t = 0;
                const shiftedIntros = introClips.map(c => {
                    const d = (c.sourceEnd - c.sourceStart) / c.speed;
                    const newC = { ...c, offset: t };
                    t += d;
                    return newC;
                });

                const shiftedMains = newMainClips.map(c => {
                    return { ...c, offset: c.offset + t };
                });
                t += currentOffset; 

                const shiftedOutros = outroClips.map(c => {
                    const d = (c.sourceEnd - c.sourceStart) / c.speed;
                    const newC = { ...c, offset: t };
                    t += d;
                    return newC;
                });

                const introDuration = shiftedIntros.reduce((acc, c) => acc + (c.sourceEnd - c.sourceStart) / c.speed, 0);
                const absoluteZooms = finalZooms.map(z => ({ ...z, start: z.start + introDuration, end: z.end + introDuration }));
                const absoluteSpotlights = finalSpotlights.map(s => ({ ...s, start: s.start + introDuration, end: s.end + introDuration }));

                const allClips = [...shiftedIntros, ...shiftedMains, ...shiftedOutros];
                const newDuration = recalculateDuration(allClips, prev.audioClips, prev.subtitles, absoluteZooms, absoluteSpotlights, prev.mosaicEffects);
                const removedSeconds = (currentMainVideo.duration - currentOffset).toFixed(1);
                const effectsAdded = absoluteZooms.length + absoluteSpotlights.length;

                return {
                    ...prev,
                    clips: allClips,
                    zoomEffects: absoluteZooms,
                    spotlightEffects: absoluteSpotlights,
                    duration: newDuration,
                    isPolishing: false,
                    showSuccessToast: true,
                    toastMessage: `✨ Magic Edit: Cut ${removedSeconds}s silence, added ${effectsAdded} effects.`
                };
            });

            setTimeout(() => {
                setState(prev => ({ ...prev, showSuccessToast: false, toastMessage: null }));
            }, 4000);

        } catch (e: any) {
            console.error("Magic Polish Failed", e);
            alert("Magic Edit failed: " + e.message);
            setState(prev => ({ ...prev, isPolishing: false }));
        }
    }, [pushHistory, recalculateDuration, setState]);

    // Enhanced with durationHint and Error Handling
    const handleLoadProject = useCallback(async (blobOrUrl: Blob | string, name: string, recordingEvents: RecordingEvent[] = [], durationHint?: number, extras?: RecordingImportExtras) => {
        let url: string;
        let storageId: string | undefined;
        // #28: everything this import wrote, removed again if the import fails before commit.
        const stagedStorageIds: string[] = [];
        const stagedUrls: string[] = [];
        let committed = false;

        try {
            if (blobOrUrl instanceof Blob) {
                storageId = generateId(); 
                try {
                    await storeAssetInDB(storageId, blobOrUrl);
                    stagedStorageIds.push(storageId);
                    url = URL.createObjectURL(blobOrUrl);
                    stagedUrls.push(url);
                } catch (e) {
                    console.error("Failed to store recording in DB", e);
                    url = URL.createObjectURL(blobOrUrl);
                    stagedUrls.push(url);
                    storageId = undefined;
                }
            } else {
                url = blobOrUrl;
            }

            let duration = 0;
            let corsCompatible = true;

            try {
                // Try to get metadata duration first
                const info = await getVideoDuration(url);
                duration = info.duration;
                corsCompatible = info.corsCompatible;
            } catch (videoError) {
                console.warn("Video metadata loading failed, falling back to hints or defaults.", videoError);
                // Non-fatal error for local blobs if we have a hint
            }

            // Fallback Logic: WebM blobs often report Infinity or 0.
            // If we have a trusted durationHint from the recorder, prefer that if the extracted duration is suspicious.
            if ((duration <= 0.1 || !Number.isFinite(duration)) && durationHint && durationHint > 0) {
                console.log(`Using recording duration hint: ${durationHint}s (Extracted: ${duration}s)`);
                duration = durationHint;
            } else if (duration <= 0.1 && blobOrUrl instanceof Blob) {
                // Last ditch fallback if no hint and extraction failed
                console.warn("Duration extraction failed for blob. Defaulting to 10s to ensure timeline visibility.");
                duration = 10.0;
            }

            const initialClip: Clip = { id: generateId(), sourceStart: 0, sourceEnd: duration, offset: 0, speed: 1.0, mediaType: 'main' };

            // #28: microphone narration recorded with the screen. Its clip mirrors the screen clip's
            // timing (screen-source time) and is linked to it; the asset carries the measured offset.
            let narrationAsset: MediaAsset | null = null;
            let narrationClips: Clip[] = [];
            if (extras?.narration && extras.narration.blob.size > 0) {
                const n = extras.narration;
                let narrationStorageId: string | undefined = generateId();
                try {
                    await storeAssetInDB(narrationStorageId, n.blob);
                    stagedStorageIds.push(narrationStorageId);
                } catch (e) {
                    console.error("Failed to store narration in DB", e);
                    narrationStorageId = undefined;
                }
                const narrationUrl = URL.createObjectURL(n.blob);
                stagedUrls.push(narrationUrl);
                narrationAsset = {
                    id: generateId(),
                    src: narrationUrl,
                    name: `${name} (Narration)`,
                    duration: Math.max(0, n.duration),
                    corsCompatible: true,
                    storageId: narrationStorageId,
                    timeOffset: n.timeOffset,
                };
                const linkId = generateId();
                initialClip.recordingLinkID = linkId;
                narrationClips = [{ ...initialClip, id: generateId(), mediaType: 'narration', recordingLinkID: linkId, muted: false }];
            }
            // #28: camera. Stored as an asset; the bubble (macOS defaults) lives on the screen clip.
            let cameraAsset: MediaAsset | null = null;
            if (extras?.camera && extras.camera.blob.size > 0) {
                const c = extras.camera;
                let cameraStorageId: string | undefined = generateId();
                try {
                    await storeAssetInDB(cameraStorageId, c.blob);
                    stagedStorageIds.push(cameraStorageId);
                } catch (e) {
                    console.error("Failed to store camera in DB", e);
                    cameraStorageId = undefined;
                }
                const cameraUrl = URL.createObjectURL(c.blob);
                stagedUrls.push(cameraUrl);
                cameraAsset = {
                    id: generateId(),
                    src: cameraUrl,
                    name: `${name} (Camera)`,
                    duration: Math.max(0, c.duration),
                    corsCompatible: true,
                    storageId: cameraStorageId,
                    timeOffset: c.timeOffset,
                };
                if (!initialClip.recordingLinkID) initialClip.recordingLinkID = generateId();
                initialClip.cameraBubble = { ...DEFAULT_CAMERA_BUBBLE };
            }
            if ((window as any).__FRAMECUT_E2E_ENABLED__ && (window as any).__FRAMECUT_E2E_FAIL_IMPORT__) {
                throw new Error('E2E: simulated import failure');
            }
            
            const asset: MediaAsset = {
                id: generateId(),
                src: url,
                name: name,
                duration: duration,
                corsCompatible: corsCompatible,
                storageId: storageId 
            };

            currentTimeRef.current = 0;
            const canAutoZoom = hasClickMetadata(recordingEvents);
            // One undo step per import, taken only once every async step has succeeded.
            pushHistory();
            committed = true;
            setState(prev => {
                const enabled = prev.autoZoomEnabled !== false;
                let zoomEffects: typeof prev.zoomEffects = [];
                let toastMessage: string | null = null;
                let showSuccessToast = false;
                if (enabled && canAutoZoom) {
                    zoomEffects = generateAutoZooms(
                        recordingEvents,
                        [initialClip],
                        duration,
                        { sensitivity: prev.autoZoomSensitivity ?? 0.5 }
                    );
                    if (zoomEffects.length > 0) {
                        toastMessage = `Auto Zoom: ${zoomEffects.length} zoom region(s) (in-tab clicks)`;
                        showSuccessToast = true;
                    }
                }
                return {
                    ...prev,
                    mainVideo: asset,
                    intro: null,
                    outro: null,
                    audio: null,
                    narration: narrationAsset,
                    narrationClips,
                    camera: cameraAsset,
                    fileName: name,
                    currentTime: 0,
                    isPlaying: false,
                    clips: [initialClip],
                    audioClips: [],
                    subtitles: [],
                    zoomEffects,
                    spotlightEffects: [],
                    mosaicEffects: [],
                    selection: null,
                    isExporting: false,
                    isExportingAudio: false,
                    exportProgress: 0,
                    showSuccessToast,
                    toastMessage,
                    duration: duration,
                    coverImage: null,
                    recordingEvents: recordingEvents
                };
            });
            if (canAutoZoom) {
                setTimeout(() => setState(prev => ({ ...prev, showSuccessToast: false, toastMessage: null })), 3000);
            }
            
            if (corsCompatible) {
                extractWaveform(url).then(waveformData => {
                    setState(prev => {
                        if (prev.mainVideo && prev.mainVideo.id === asset.id) {
                            return {
                                ...prev,
                                mainVideo: { ...prev.mainVideo, waveformData }
                            };
                        }
                        return prev;
                    });
                }).catch(e => console.warn("Waveform extract failed", e));
            }
            if (narrationAsset) {
                const narrationId = narrationAsset.id;
                extractWaveform(narrationAsset.src).then(waveformData => {
                    setState(prev => prev.narration && prev.narration.id === narrationId
                        ? { ...prev, narration: { ...prev.narration, waveformData } }
                        : prev);
                }).catch(e => console.warn("Narration waveform extract failed", e));
            }
        } catch (e: any) {
            if (!committed) {
                // Roll back partial installs so a failed import leaves no stored media behind.
                for (const id of stagedStorageIds) deleteAssetFromDB(id).catch(() => {});
                for (const u of stagedUrls) URL.revokeObjectURL(u);
            }
            console.error("Critical Error Loading Project/Recording", e);
            alert("Failed to load recording: " + (e.message || "Unknown error"));
        }
    }, [currentTimeRef, setState, pushHistory]);

    // ... (handleUrlImport kept as is) ...
    const handleUrlImport = async (type: 'intro' | 'main' | 'outro' | 'audio', url: string) => {
        if (type === 'main' && !confirmMainReplacement()) return;
        pushHistory();
        try {
            const { duration, corsCompatible } = await getVideoDuration(url);
            const asset: MediaAsset = {
                id: generateId(),
                src: url,
                name: url.split('/').pop() || 'Remote Video',
                duration: duration,
                corsCompatible: corsCompatible
            };
            updateStateWithAsset(type, asset, duration);
            if (corsCompatible) {
                extractWaveform(url).then(waveformData => {
                    setState(prev => {
                        const currentAsset = type === 'intro' ? prev.intro : type === 'outro' ? prev.outro : type === 'audio' ? prev.audio : prev.mainVideo;
                        if (currentAsset && currentAsset.id === asset.id) {
                            const updated = { ...prev };
                            if (type === 'intro') updated.intro = { ...currentAsset, waveformData };
                            else if (type === 'main') updated.mainVideo = { ...currentAsset, waveformData };
                            else if (type === 'outro') updated.outro = { ...currentAsset, waveformData };
                            else if (type === 'audio') updated.audio = { ...currentAsset, waveformData };
                            return updated;
                        }
                        return prev;
                    });
                }).catch(e => console.warn("Waveform extract failed", e));
            }
        } catch (e: any) {
            console.error("URL Import Failed", e);
            alert(typeof e === 'string' ? e : (e.message || "Failed to load video from URL."));
            throw e;
        }
    };

    // Modified to accept existingId for Re-linking functionality
    const handleUploadAsset = async (type: 'intro' | 'main' | 'outro' | 'audio', file: File, existingId?: string) => {
        if (type === 'main' && !existingId && !confirmMainReplacement()) return;
        pushHistory();
        try {
            let storageId = generateId();
            try {
                // Store uploaded file in IndexedDB immediately
                await storeAssetInDB(storageId, file);
            } catch (e) {
                console.error("IndexedDB write failed", e);
                storageId = ''; // Proceed without persistence if DB fails
            }

            const url = URL.createObjectURL(file);
            let duration = 0;
            let isImage = false;

            // CHECK FILE TYPE: Image vs Video/Audio
            if (file.type.startsWith('image/')) {
                isImage = true;
                duration = 5.0; // Default duration for images (like colors)
            } else {
                const info = await getVideoDuration(url);
                duration = info.duration;
            }
            
            // If existingId is provided, we are replacing/re-linking media, not creating new.
            const asset: MediaAsset = { 
                id: existingId || generateId(), 
                src: isImage ? `image:${url}` : url, 
                name: file.name, 
                duration: duration, 
                corsCompatible: true,
                storageId: storageId || undefined
            };
            
            updateStateWithAsset(type, asset, duration, !!existingId);
            
            if (!isImage) {
                extractWaveform(url).then(waveformData => {
                    setState(prev => {
                        const currentAsset = type === 'intro' ? prev.intro : type === 'outro' ? prev.outro : type === 'audio' ? prev.audio : prev.mainVideo;
                        if (currentAsset && currentAsset.id === asset.id) {
                            const updatedAsset = { ...currentAsset, waveformData };
                            const updated = { ...prev };
                            if (type === 'intro') updated.intro = updatedAsset;
                            else if (type === 'main') updated.mainVideo = updatedAsset;
                            else if (type === 'outro') updated.outro = updatedAsset;
                            else if (type === 'audio') updated.audio = updatedAsset;
                            return updated;
                        }
                        return prev;
                    });
                });
            }
        } catch (e) {
            console.error("Failed to load media", e);
            alert("Failed to load file. Please try a different one.");
        }
    };

    const handleSetColorAsset = (type: 'intro' | 'outro', color: string) => {
        pushHistory();
        
        setState(prev => {
            const existingClip = prev.clips.find(c => c.mediaType === type);
            // Calculate current duration of the slot if it exists, otherwise default to 5s
            const currentDuration = existingClip 
                ? (existingClip.sourceEnd - existingClip.sourceStart) / existingClip.speed 
                : 5.0;

            const asset: MediaAsset = { 
                id: generateId(), 
                src: `color:${color}`, 
                name: `Color Block`, 
                duration: currentDuration, // Match asset metadata to current usage
                corsCompatible: true 
            };

            let newState = { ...prev };
            
            // 1. Update the Asset Reference
            if (type === 'intro') newState.intro = asset;
            else newState.outro = asset;

            // 2. Update Timeline Clips (ONLY if clip doesn't exist)
            // If clip exists, we leave it alone. The 'mediaType' reference will now point to the new color asset.
            if (!existingClip) {
                if (type === 'intro') {
                    const otherClips = prev.clips.filter(c => c.mediaType !== 'intro');
                    const newIntroClip: Clip = { id: generateId(), sourceStart: 0, sourceEnd: 5.0, offset: 0, speed: 1.0, mediaType: 'intro' };
                    
                    otherClips.sort((a, b) => a.offset - b.offset);
                    let currentOffset = 5.0;
                    const shiftedClips = otherClips.map(c => {
                        const dur = (c.sourceEnd - c.sourceStart) / c.speed;
                        const clip = { ...c, offset: currentOffset };
                        currentOffset += dur;
                        return clip;
                    });
                    newState.clips = [newIntroClip, ...shiftedClips];
                } else {
                    const otherClips = prev.clips.filter(c => c.mediaType !== 'outro');
                    otherClips.sort((a, b) => a.offset - b.offset);
                    let currentOffset = 0;
                    otherClips.forEach(c => {
                        const dur = (c.sourceEnd - c.sourceStart) / c.speed;
                        currentOffset = Math.max(currentOffset, c.offset + dur);
                    });
                    const newOutroClip: Clip = { id: generateId(), sourceStart: 0, sourceEnd: 5.0, offset: currentOffset, speed: 1.0, mediaType: 'outro' };
                    newState.clips = [...otherClips, newOutroClip];
                }
            }

            newState.duration = recalculateDuration(newState.clips, newState.audioClips, newState.subtitles, newState.zoomEffects, newState.spotlightEffects, newState.mosaicEffects);
            return newState;
        });
    };

    const handleRemoveAsset = (type: 'intro' | 'main' | 'outro' | 'audio') => {
        pushHistory();
        setState(prev => {
            let newState = { ...prev };
            let removedAsset: MediaAsset | null = null;

            if (type === 'intro') { removedAsset = newState.intro; newState.intro = null; }
            if (type === 'outro') { removedAsset = newState.outro; newState.outro = null; }
            if (type === 'main') { removedAsset = newState.mainVideo; newState.mainVideo = null; }
            if (type === 'audio') { removedAsset = newState.audio; newState.audio = null; }

            // Clean up from DB if it exists
            if (removedAsset && removedAsset.storageId) {
                deleteAssetFromDB(removedAsset.storageId).catch(console.error);
            }

            const remainingClips = newState.clips.filter(c => c.mediaType !== type);
            remainingClips.sort((a, b) => a.offset - b.offset);
            let currentOffset = 0;
            const shiftedClips = remainingClips.map(c => {
                const dur = (c.sourceEnd - c.sourceStart) / c.speed;
                const clip = { ...c, offset: currentOffset };
                currentOffset += dur;
                return clip;
            });
            newState.clips = shiftedClips;
            newState.audioClips = newState.audioClips.filter(c => c.mediaType !== type);
            newState.duration = recalculateDuration(newState.clips, newState.audioClips, newState.subtitles, newState.zoomEffects, newState.spotlightEffects, newState.mosaicEffects);
            return newState;
        });
    };

    /**
     * Auto Zoom (#22) regenerate/repair: rebuild cursor-following regions from in-tab
     * click metadata. Replaces untouched auto regions; keeps manual/edited ones.
     * Primary path is auto-generate after recording/import; this is on-demand repair.
     */
    const handleAutoZoom = useCallback((recordingEvents: RecordingEvent[]) => {
        if (!hasClickMetadata(recordingEvents)) {
            alert('Auto Zoom needs a screen recording with clicks captured inside this browser tab. Imported MP4s without click metadata cannot auto-zoom.');
            return;
        }
        pushHistory();
        setState(prev => {
            const generated = generateAutoZooms(recordingEvents, prev.clips, prev.duration, {
                sensitivity: prev.autoZoomSensitivity ?? 0.5
            });
            const zoomEffects = mergeAutoZooms(prev.zoomEffects, generated);
            return {
                ...prev,
                autoZoomEnabled: true,
                zoomEffects,
                duration: recalculateDuration(prev.clips, prev.audioClips, prev.subtitles, zoomEffects, prev.spotlightEffects, prev.mosaicEffects),
                toastMessage: `Auto Zoom: ${zoomEffects.filter(z => z.auto).length} zoom region(s) (in-tab clicks)`,
                showSuccessToast: true
            };
        });
        setTimeout(() => setState(prev => ({ ...prev, showSuccessToast: false, toastMessage: null })), 3000);
    }, [setState, pushHistory, recalculateDuration]);

    /** Remove auto-generated zoom regions only (manual/edited segments stay). */
    const handleRemoveAutoZooms = useCallback(() => {
        pushHistory();
        setState(prev => {
            const zoomEffects = removeAutoZooms(prev.zoomEffects);
            return {
                ...prev,
                zoomEffects,
                duration: recalculateDuration(prev.clips, prev.audioClips, prev.subtitles, zoomEffects, prev.spotlightEffects, prev.mosaicEffects),
                toastMessage: 'Removed auto zoom regions',
                showSuccessToast: true
            };
        });
        setTimeout(() => setState(prev => ({ ...prev, showSuccessToast: false, toastMessage: null })), 2500);
    }, [setState, pushHistory, recalculateDuration]);

    /** #23: optional auto-spotlight from in-tab clicks. Replaces previous auto spotlights, keeps manual ones. */
    const handleAutoSpotlight = useCallback((recordingEvents: RecordingEvent[]) => {
        if (!hasClickMetadata(recordingEvents)) {
            alert('Auto Spotlight needs a screen recording with clicks captured inside this browser tab. Imported MP4s without click metadata have no click polish.');
            return;
        }
        pushHistory();
        setState(prev => {
            const generated = generateAutoSpotlights(recordingEvents, prev.clips, generateId);
            const spotlightEffects = mergeAutoSpotlights(prev.spotlightEffects, generated);
            return {
                ...prev,
                spotlightEffects,
                duration: recalculateDuration(prev.clips, prev.audioClips, prev.subtitles, prev.zoomEffects, spotlightEffects, prev.mosaicEffects),
                toastMessage: `Auto Spotlight: ${generated.length} spotlight(s) from in-tab clicks`,
                showSuccessToast: true
            };
        });
        setTimeout(() => setState(prev => ({ ...prev, showSuccessToast: false, toastMessage: null })), 3000);
    }, [setState, pushHistory, recalculateDuration]);

    const handleSetClickRipplesEnabled = useCallback((enabled: boolean) => {
        setState(prev => ({ ...prev, clickRipplesEnabled: enabled }));
    }, [setState]);

    const handleSetAutoZoomEnabled = useCallback((enabled: boolean) => {
        setState(prev => ({ ...prev, autoZoomEnabled: enabled }));
    }, [setState]);

    const handleSetAutoZoomSensitivity = useCallback((sensitivity: number) => {
        const s = Math.min(1, Math.max(0, sensitivity));
        setState(prev => ({ ...prev, autoZoomSensitivity: s }));
    }, [setState]);

    return {
        handleLoadProject,
        handleMagicPolish,
        handleAutoZoom,
        handleRemoveAutoZooms,
        handleAutoSpotlight,
        handleSetClickRipplesEnabled,
        handleSetAutoZoomEnabled,
        handleSetAutoZoomSensitivity,
        handleUrlImport,
        handleUploadAsset,
        handleSetColorAsset,
        handleRemoveAsset
    };
};
