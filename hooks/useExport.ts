import React, { useCallback, useState, RefObject } from 'react';
import { Clip, ExtendedEditorState, PlayerRef } from '../types';
import { renderProjectAudio, audioBufferToWav } from '../utils/audioRenderer';
import { DEFAULT_GIF_OPTIONS, GifOptions, formatBytes } from '../utils/exportPresets';
import { GifMemoryError, StreamingGifEncoder, isWebLimitError } from '../utils/gifExport';
import { isHeapNearLimit, planGifExport, readDeviceBudget } from '../utils/gifPlan';

export interface GifWebLimitInfo {
    reason: 'size' | 'memory' | 'trimmed';
    detail: string;
}

interface UseExportProps {
    state: ExtendedEditorState;
    setState: React.Dispatch<React.SetStateAction<ExtendedEditorState>>;
    playerRef: RefObject<PlayerRef>;
    currentTimeRef: React.MutableRefObject<number>;
}

const getClipDuration = (clip: Clip) => (clip.sourceEnd - clip.sourceStart) / clip.speed;
const getClipEnd = (clip: Clip) => clip.offset + getClipDuration(clip);

const sanitizeBaseName = (fileName: string | null) => (
    (fileName || 'project').replace(/[^a-z0-9\-_ ]/gi, '').trim() || 'project'
);

const downloadBlob = (blob: Blob, baseName: string, extension: string) => {
    if (blob.size <= 0) return;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.download = `framecut-${baseName}-${timestamp}.${extension}`;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 1000);
};

const findActiveClipAtTime = (clips: Clip[], time: number, cursor: { index: number }) => {
    while (cursor.index < clips.length && time >= getClipEnd(clips[cursor.index])) {
        cursor.index += 1;
    }

    const clip = clips[cursor.index];
    if (!clip) return null;

    if (time < clip.offset) return null;
    return time < getClipEnd(clip) ? clip : null;
};

export const useExport = ({ state, setState, playerRef, currentTimeRef }: UseExportProps) => {
    /** Shown when a GIF hits the browser's limits: suggests the FrameCut macOS app. */
    const [gifWebLimit, setGifWebLimit] = useState<GifWebLimitInfo | null>(null);

    /**
     * Render frames offline and stream them into gifenc (Web Worker) as they are rendered.
     * Settings adapt to the project (planGifExport, PROVISIONAL limits); memory is bounded by the
     * in-flight queue and guarded against the JS heap limit.
     */
    const exportGif = useCallback(async (opts: GifOptions) => {
        const player = playerRef.current;
        if (!player) return;
        // Lock the export canvas at source size and render into it explicitly. Previously getCanvas()
        // ran before isExporting committed and returned the (never-updated) preview canvas.
        const sourceCanvas = player.getCanvas();
        if (!sourceCanvas) throw new Error('No canvas found');
        const canvas = player.prepareExportCanvas
            ? player.prepareExportCanvas(sourceCanvas.width, sourceCanvas.height)
            : sourceCanvas;

        const plan = planGifExport(canvas.width, canvas.height, state.duration, opts, readDeviceBudget());
        if ((window as any).__FRAMECUT_E2E_ENABLED__) (window as any).__FRAMECUT_LAST_GIF_PLAN__ = plan;
        const { width, height, duration, fps, colors } = plan;
        const frameCanvas = document.createElement('canvas');
        frameCanvas.width = width;
        frameCanvas.height = height;
        const ctx = frameCanvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Could not create GIF frame canvas');

        const encoder = new StreamingGifEncoder({ width, height, fps, colors, loop: opts.loop, maxBytes: plan.hardCapBytes });
        const totalFrames = Math.max(1, Math.ceil(duration * fps));
        const sortedClips = [...state.clips].sort((a, b) => a.offset - b.offset);
        const clipCursor = { index: 0 };
        let activeClipId: string | null = null;
        let activeClipMode: 'video' | 'static' | 'empty' = 'empty';
        let lastUiUpdate = performance.now();

        let blob: Blob;
        try {
            for (let i = 0; i < totalFrames; i++) {
                if (isHeapNearLimit()) throw new GifMemoryError();
                const time = Math.min(duration, i / fps);
                const activeClip = findActiveClipAtTime(sortedClips, time, clipCursor);
                if (i === 0 || activeClip?.id !== activeClipId) {
                    // GIF export isn't realtime: seek frame-accurately instead of free-running playback.
                    activeClipMode = await player.prepareExportPlayback(activeClip, { frameAccurate: true });
                    activeClipId = activeClip?.id ?? null;
                }
                currentTimeRef.current = time;
                if (activeClip && activeClipMode === 'video') {
                    await player.syncExportPlayback(activeClip.sourceStart + ((time - activeClip.offset) * activeClip.speed));
                } else {
                    await player.seekTo(time);
                }
                player.renderFrame('export');

                ctx.fillStyle = state.canvasBackgroundColor || '#000000';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(canvas, 0, 0, width, height);
                // Waits while GIF_MAX_FRAMES_IN_FLIGHT frames are queued; rejects on size/worker failure.
                await encoder.addFrame(ctx.getImageData(0, 0, width, height));

                if (i === totalFrames - 1 || performance.now() - lastUiUpdate >= 150) {
                    lastUiUpdate = performance.now();
                    const progress = Math.max(1, Math.floor(((i + 1) / totalFrames) * 95));
                    setState(prev => ({ ...prev, currentTime: time, exportProgress: progress }));
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }
            blob = await encoder.finish();
        } catch (e) {
            encoder.fail(e instanceof Error ? e : new Error(String(e)));
            throw e;
        }

        downloadBlob(blob, sanitizeBaseName(state.fileName), 'gif');
        const adjusted = plan.downgrades.length ? ` — adjusted: ${plan.downgrades.join(', ')}` : '';
        setState(prev => ({
            ...prev,
            isExporting: false,
            isExportingAudio: false,
            currentTime: 0,
            exportProgress: 100,
            showSuccessToast: true,
            toastMessage: `GIF exported (${formatBytes(blob.size)})${adjusted}`
        }));
        if (plan.exceedsWebLimits) {
            setGifWebLimit({ reason: 'trimmed', detail: `Exported the first ${plan.duration}s; the full project is too long for a browser GIF.` });
        }
        setTimeout(() => setState(prev => ({ ...prev, showSuccessToast: false, toastMessage: null })), 3000);
    }, [state, setState, currentTimeRef, playerRef]);

    const handleExportAction = useCallback(async (audioOnly: boolean, format?: 'mp4' | 'webm' | 'wav' | 'm4a' | 'gif', gifOptions: GifOptions = DEFAULT_GIF_OPTIONS) => {
        if (state.clips.length === 0 && state.audioClips.length === 0) return;
        if (!playerRef.current) return;

        const player = playerRef.current;
        const baseName = sanitizeBaseName(state.fileName);

        currentTimeRef.current = 0;
        player.beginExport?.();
        setState(prev => ({
            ...prev,
            isPlaying: false,
            currentTime: 0,
            exportProgress: 0,
            isExporting: true,
            isExportingAudio: audioOnly
        }));

        try {
            if (!audioOnly && format === 'gif') {
                await exportGif(gifOptions);
                return;
            }

            const audioBuffer = await renderProjectAudio(state);

            if (audioOnly) {
                if (!audioBuffer) {
                    throw new Error('Could not generate audio buffer. Is the project empty or muted?');
                }

                setState(prev => ({ ...prev, exportProgress: 50 }));

                if (format === 'm4a') {
                    downloadBlob(await player.encodeAudioAsM4a(audioBuffer), baseName, 'm4a');
                } else {
                    downloadBlob(audioBufferToWav(audioBuffer), baseName, 'wav');
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

            const canvas = player.getCanvas();
            if (!canvas) throw new Error('No canvas found');

            const width = Math.floor(canvas.width / 2) * 2;
            const height = Math.floor(canvas.height / 2) * 2;
            const fps = 30;
            const recorder = playerRef.current;

            const exportConfig = await recorder.startOfflineSession(width, height, fps, audioBuffer);
            let exportCanvas = canvas;
            if (exportConfig && recorder.prepareExportCanvas) {
                exportCanvas = recorder.prepareExportCanvas(exportConfig.width, exportConfig.height);
            }

            const duration = state.duration;
            const totalFrames = Math.ceil(duration * fps);
            const sortedClips = [...state.clips].sort((a, b) => a.offset - b.offset);
            const clipCursor = { index: 0 };
            let activeClipId: string | null = null;
            let activeClipMode: 'video' | 'static' | 'empty' = 'empty';
            let lastUiUpdate = performance.now();

            for (let i = 0; i <= totalFrames; i++) {
                const time = i / fps;
                const activeClip = findActiveClipAtTime(sortedClips, time, clipCursor);

                if (activeClip?.id !== activeClipId) {
                    activeClipMode = await player.prepareExportPlayback(activeClip);
                    activeClipId = activeClip?.id ?? null;
                }

                currentTimeRef.current = time;

                if (activeClip && activeClipMode === 'video') {
                    const sourceTime = activeClip.sourceStart + ((time - activeClip.offset) * activeClip.speed);
                    await player.syncExportPlayback(sourceTime);
                } else if (activeClipMode !== 'video') {
                    await player.seekTo(time);
                }

                player.renderFrame('export');

                const timestampUs = time * 1_000_000;
                const isKeyFrame = i % (fps * 2) === 0;
                await recorder.addVideoFrame(exportCanvas, timestampUs, isKeyFrame);

                const shouldUpdateUi = i === totalFrames || performance.now() - lastUiUpdate >= 150;
                if (shouldUpdateUi) {
                    lastUiUpdate = performance.now();
                    const progress = Math.floor((i / totalFrames) * 100);
                    setState(prev => (
                        prev.exportProgress === progress && prev.currentTime === time
                            ? prev
                            : { ...prev, currentTime: time, exportProgress: progress }
                    ));
                }
            }

            const blob = await recorder.finishOfflineSession();
            downloadBlob(blob, baseName, 'mp4');

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
            console.error('Offline Export Failed', e);
            // Reset progress too: the overlay used to stay up because it only hid at 0 or 100 %.
            setState(prev => ({ ...prev, isExporting: false, isExportingAudio: false, exportProgress: 0 }));
            if (isWebLimitError(e)) {
                // Browser limits reached: offer the macOS app instead of a bare alert.
                setGifWebLimit({ reason: e instanceof GifMemoryError ? 'memory' : 'size', detail: e.message });
            } else {
                alert('Export failed: ' + (e?.message || e));
            }
        } finally {
            const recorder = playerRef.current;
            playerRef.current?.stopExportPlayback();
            recorder?.releaseExportCanvas?.();
            recorder?.endExport?.();
        }
    }, [state, setState, currentTimeRef, playerRef, exportGif]);

    return {
        handleExportAction,
        gifWebLimit,
        dismissGifWebLimit: () => setGifWebLimit(null),
    };
};
