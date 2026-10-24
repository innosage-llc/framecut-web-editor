import React, { useCallback, RefObject } from 'react';
import { Clip, ExtendedEditorState, PlayerRef } from '../types';
import { renderProjectAudio, audioBufferToWav } from '../utils/audioRenderer';
import { DEFAULT_GIF_OPTIONS, GifOptions, GIF_MAX_DURATION_S, GIF_MAX_FILE_BYTES, formatBytes } from '../utils/exportPresets';
import { encodeGifWithGifJs, getGifSize, GifTooLargeError, resolveGifExportPlan } from '../utils/gifExport';

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
    /** Render frames offline, encode with gif.js, enforce length/resolution/size limits. */
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

        const plan = resolveGifExportPlan(canvas.width, canvas.height, state.duration, opts);
        if (state.duration > GIF_MAX_DURATION_S && !opts.trimToMaxDuration) {
            throw new Error(
                `GIF exports are limited to ${GIF_MAX_DURATION_S}s. Enable "Trim to ${GIF_MAX_DURATION_S}s" or shorten the project.`
            );
        }

        const { width, height, duration } = plan;
        const frameCanvas = document.createElement('canvas');
        frameCanvas.width = width;
        frameCanvas.height = height;
        const ctx = frameCanvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Could not create GIF frame canvas');

        const fps = opts.fps;
        const totalFrames = Math.max(1, Math.ceil(duration * fps));
        const sortedClips = [...state.clips].sort((a, b) => a.offset - b.offset);
        const clipCursor = { index: 0 };
        let activeClipId: string | null = null;
        let activeClipMode: 'video' | 'static' | 'empty' = 'empty';
        let lastUiUpdate = performance.now();
        const frames: Array<{ canvas: HTMLCanvasElement }> = [];

        for (let i = 0; i < totalFrames; i++) {
            const time = Math.min(duration, i / fps);
            const activeClip = findActiveClipAtTime(sortedClips, time, clipCursor);
            if (i === 0 || activeClip?.id !== activeClipId) {
                activeClipMode = await player.prepareExportPlayback(activeClip);
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
            // Copy pixels now; gif.js needs stable frame data across the async render.
            const copy = document.createElement('canvas');
            copy.width = width;
            copy.height = height;
            copy.getContext('2d')!.drawImage(frameCanvas, 0, 0);
            frames.push({ canvas: copy });

            if (i === totalFrames - 1 || performance.now() - lastUiUpdate >= 150) {
                lastUiUpdate = performance.now();
                const progress = Math.floor(((i + 1) / totalFrames) * 70);
                setState(prev => ({ ...prev, currentTime: time, exportProgress: progress }));
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        const blob = await encodeGifWithGifJs(frames, {
            width,
            height,
            fps,
            loop: opts.loop,
            onProgress: (p) => setState(prev => ({ ...prev, exportProgress: 70 + Math.floor(p * 25) })),
        });

        downloadBlob(blob, sanitizeBaseName(state.fileName), 'gif');
        setState(prev => ({
            ...prev,
            isExporting: false,
            isExportingAudio: false,
            currentTime: 0,
            exportProgress: 100,
            showSuccessToast: true,
            toastMessage: `GIF exported (${formatBytes(blob.size)})`
        }));
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
            const msg = e instanceof GifTooLargeError
                ? `${e.message}. Try a lower frame rate or a smaller max size, then export again.`
                : ('Export failed: ' + (e?.message || e));
            // Reset progress too: the overlay used to stay up because it only hid at 0 or 100 %.
            setState(prev => ({ ...prev, isExporting: false, isExportingAudio: false, exportProgress: 0 }));
            alert(msg);
        } finally {
            const recorder = playerRef.current;
            playerRef.current?.stopExportPlayback();
            recorder?.releaseExportCanvas?.();
            recorder?.endExport?.();
        }
    }, [state, setState, currentTimeRef, playerRef, exportGif]);

    return {
        handleExportAction
    };
};
