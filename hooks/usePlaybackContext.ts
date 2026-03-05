
import { useMemo } from 'react';
import { Clip, MediaAsset, EditorState } from '../types';

interface UsePlaybackContextProps {
    state: EditorState;
}

export const usePlaybackContext = ({ state }: UsePlaybackContextProps) => {
    
    // Helper to resolve the actual MediaAsset based on the clip type
    const getAsset = (mediaType: 'intro' | 'main' | 'outro' | 'audio') => {
        if (mediaType === 'intro') return state.intro;
        if (mediaType === 'outro') return state.outro;
        if (mediaType === 'audio') return state.audio;
        return state.mainVideo;
    };

    const context = useMemo(() => {
        const globalTime = state.currentTime;

        // 1. Video Context Calculation
        const activeVideoClip = state.clips.find((clip: Clip) => {
            const duration = (clip.sourceEnd - clip.sourceStart) / clip.speed;
            return globalTime >= clip.offset && globalTime < clip.offset + duration;
        });

        let videoCtx = {
            src: null as string | null,
            time: 0,
            playbackRate: state.playbackRate,
            mediaType: null as 'intro' | 'main' | 'outro' | 'audio' | null,
            muted: false,
            corsCompatible: true,
            clipTiming: null as { offset: number, sourceStart: number, speed: number } | null,
            crop: undefined as { x: number, y: number, width: number, height: number } | undefined
        };

        if (activeVideoClip) {
            const asset = getAsset(activeVideoClip.mediaType);
            if (asset) {
                const timeIntoClipVisual = globalTime - activeVideoClip.offset;
                const timeIntoClipSource = timeIntoClipVisual * activeVideoClip.speed;

                let computedTime = activeVideoClip.sourceStart + timeIntoClipSource;
                
                // Handle looping or clamping if necessary (though clips usually define exact bounds)
                if (asset.duration > 0 && !asset.src.startsWith('color:')) {
                    computedTime = computedTime % asset.duration;
                }

                videoCtx = {
                    src: asset.src,
                    time: computedTime,
                    playbackRate: state.playbackRate * activeVideoClip.speed,
                    mediaType: activeVideoClip.mediaType,
                    muted: activeVideoClip.muted || false,
                    corsCompatible: asset.corsCompatible ?? true,
                    clipTiming: {
                        offset: activeVideoClip.offset,
                        sourceStart: activeVideoClip.sourceStart,
                        speed: activeVideoClip.speed
                    },
                    crop: activeVideoClip.crop
                };
            }
        }

        // 2. Audio Context Calculation
        const activeAudioClip = state.audioClips.find((clip: Clip) => {
            const duration = (clip.sourceEnd - clip.sourceStart) / clip.speed;
            return globalTime >= clip.offset && globalTime < clip.offset + duration;
        });

        let audioCtx = {
            src: null as string | null,
            time: 0,
            playbackRate: state.playbackRate
        };

        if (activeAudioClip) {
            const asset = getAsset(activeAudioClip.mediaType);
            if (asset) {
                if (asset.src.startsWith('color:')) {
                    audioCtx = { src: null, time: 0, playbackRate: 1 };
                } else {
                    const timeIntoClipVisual = globalTime - activeAudioClip.offset;
                    const timeIntoClipSource = timeIntoClipVisual * activeAudioClip.speed;

                    let computedTime = activeAudioClip.sourceStart + timeIntoClipSource;
                    if (asset.duration > 0) {
                        computedTime = computedTime % asset.duration;
                    }

                    audioCtx = {
                        src: asset.src,
                        time: computedTime,
                        playbackRate: state.playbackRate * activeAudioClip.speed
                    };
                }
            }
        }

        return { videoCtx, audioCtx };
    }, [state.currentTime, state.clips, state.audioClips, state.intro, state.mainVideo, state.outro, state.audio, state.playbackRate]);

    return context;
};
