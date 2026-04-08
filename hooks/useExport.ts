import React, { useCallback, RefObject } from 'react';
import { Clip, ExtendedEditorState, PlayerRef } from '../types';
import { renderProjectAudio, audioBufferToWav } from '../utils/audioRenderer';

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
    const handleExportAction = useCallback(async (audioOnly: boolean, format?: 'mp4' | 'webm' | 'wav' | 'm4a') => {
        if (state.clips.length === 0 && state.audioClips.length === 0) return;
        if (!playerRef.current) return;

        const player = playerRef.current;
        const baseName = sanitizeBaseName(state.fileName);

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

                player.renderFrame();

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
            alert('Export failed: ' + e.message);
            setState(prev => ({ ...prev, isExporting: false, isExportingAudio: false }));
        } finally {
            const recorder = playerRef.current;
            playerRef.current?.stopExportPlayback();
            recorder?.releaseExportCanvas?.();
        }
    }, [state, setState, currentTimeRef, playerRef]);

    return {
        handleExportAction
    };
};
