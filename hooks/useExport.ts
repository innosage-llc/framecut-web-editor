
import React, { useCallback, useEffect, RefObject, useRef } from 'react';
import { ExtendedEditorState, PlayerRef } from '../types';
import { renderProjectAudio, audioBufferToWav } from '../utils/audioRenderer';

interface UseExportProps {
    state: ExtendedEditorState;
    setState: React.Dispatch<React.SetStateAction<ExtendedEditorState>>;
    playerRef: RefObject<PlayerRef>;
    currentTimeRef: React.MutableRefObject<number>;
}

export const useExport = ({ state, setState, playerRef, currentTimeRef }: UseExportProps) => {
    
    // Prevent double-triggering export finish
    const isFinishingRef = useRef(false);

    const handleExportAction = useCallback(async (audioOnly: boolean, format?: 'mp4' | 'webm' | 'wav' | 'm4a') => {
        if (state.clips.length === 0 && state.audioClips.length === 0) return;
        if (!playerRef.current) return;

        // 1. Reset state
        currentTimeRef.current = 0;
        setState(prev => ({ 
            ...prev, 
            isPlaying: false, 
            currentTime: 0, 
            exportProgress: 0,
            isExporting: true, 
            isExportingAudio: audioOnly 
        }));

        try {
            // 2. Prepare Audio (Render complete timeline to buffer)
            const audioBuffer = await renderProjectAudio(state);
            
            if (audioOnly) {
                if (!audioBuffer) {
                    throw new Error("Could not generate audio buffer. Is the project empty or muted?");
                }
                
                setState(prev => ({ ...prev, exportProgress: 50 }));
                let blob: Blob;
                let ext = 'wav';

                if (format === 'm4a') {
                    console.log("Encoding AAC (M4A)...");
                    blob = await playerRef.current.encodeAudioAsM4a(audioBuffer);
                    ext = 'm4a';
                } else {
                    // Default to WAV
                    console.log("Encoding WAV...");
                    blob = audioBufferToWav(audioBuffer);
                }
                
                if (blob.size > 0) {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = url;
                    const baseName = (state.fileName || 'project').replace(/[^a-z0-9\-_ ]/gi, '').trim() || 'project';
                    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
                    a.download = `framecut-${baseName}-${timestamp}.${ext}`;
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(() => {
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    }, 1000);
                }

                setState(prev => ({ 
                    ...prev, 
                    isExporting: false, 
                    isExportingAudio: false, 
                    currentTime: 0, 
                    exportProgress: 100, 
                    showSuccessToast: true 
                }));
                setTimeout(() => setState(prev => ({ ...prev, showSuccessToast: false })), 3000);
                return;
            }

            // 3. Initialize Offline Session (Video)
            // Determine dimensions from canvas
            const canvas = playerRef.current.getCanvas();
            if (!canvas) throw new Error("No canvas found");
            
            // Align dimensions to 2 (H.264 requirement usually)
            const width = Math.floor(canvas.width / 2) * 2;
            const height = Math.floor(canvas.height / 2) * 2;
            const fps = 30;
            
            // Cast to any because the new methods are dynamically added via useImperativeHandle
            const recorder = playerRef.current as any;
            
            const exportConfig = await recorder.startOfflineSession(width, height, fps, audioBuffer);
            let exportCanvas = canvas;
            if (exportConfig && recorder.prepareExportCanvas) {
                exportCanvas = recorder.prepareExportCanvas(exportConfig.width, exportConfig.height);
            }

            // 4. Frame Loop
            const duration = state.duration;
            const totalFrames = Math.ceil(duration * fps);
            
            for (let i = 0; i <= totalFrames; i++) {
                const time = i / fps;
                
                // Update State Time (Syncs React Contexts)
                currentTimeRef.current = time;
                setState(prev => ({ ...prev, currentTime: time, exportProgress: Math.floor((i / totalFrames) * 100) }));
                
                // Seek Video Elements (Wait for seeked event)
                await playerRef.current.seekTo(time);
                
                // Force Render to Canvas (Synchronous-ish)
                playerRef.current.renderFrame();
                
                // Add Frame to Encoder
                const timestampUs = time * 1_000_000;
                // Keyframe every 2 seconds
                const isKeyFrame = i % (fps * 2) === 0;
                
                await recorder.addVideoFrame(exportCanvas, timestampUs, isKeyFrame);
                
                // Allow UI to breathe slightly
                await new Promise(r => setTimeout(r, 0));
            }

            console.log('Recorder stopped, generating blob...');

            // 5. Finalize
            const blob = await recorder.finishOfflineSession();
            
            // 6. Download
            if (blob.size > 0) {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                const baseName = (state.fileName || 'project').replace(/[^a-z0-9\-_ ]/gi, '').trim() || 'project';
                const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
                a.download = `framecut-${baseName}-${timestamp}.mp4`;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, 1000);
            }

            // 7. Cleanup
            setState(prev => ({ 
                ...prev, 
                isExporting: false, 
                isExportingAudio: false, 
                currentTime: 0, 
                exportProgress: 100, 
                showSuccessToast: true 
            }));
            setTimeout(() => setState(prev => ({ ...prev, showSuccessToast: false })), 3000);

        } catch (e: any) {
            console.error("Offline Export Failed", e);
            alert("Export failed: " + e.message);
            setState(prev => ({ ...prev, isExporting: false }));
        } finally {
            const recorder = playerRef.current as any;
            recorder?.releaseExportCanvas?.();
        }

    }, [state, setState, currentTimeRef, playerRef]);

    return {
        handleExportAction
    };
};
