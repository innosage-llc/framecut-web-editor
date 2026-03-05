
import { useEffect, RefObject } from 'react';

interface UseMediaSyncProps {
    introRef: RefObject<HTMLVideoElement>;
    mainRef: RefObject<HTMLVideoElement>;
    outroRef: RefObject<HTMLVideoElement>;
    audioRef: RefObject<HTMLAudioElement>;
    activeMediaType: 'intro' | 'main' | 'outro' | 'audio' | null;
    sourceTime: number | null;
    audioSourceTime: number;
    isPlaying: boolean;
    playbackRate: number;
    audioPlaybackRate: number;
    isMuted: boolean;
    isAudioTrackMuted: boolean;
    src: string | null; // Keep for color/image logic checks if needed, but rely on refs for video
    isExporting?: boolean;
}

export const useMediaSync = ({
    introRef,
    mainRef,
    outroRef,
    audioRef,
    activeMediaType,
    sourceTime,
    audioSourceTime,
    isPlaying,
    playbackRate,
    audioPlaybackRate,
    isMuted,
    isAudioTrackMuted,
    src,
    isExporting = false
}: UseMediaSyncProps) => {

    // Helper to get all video refs
    const getVideoRefs = () => [introRef, mainRef, outroRef];

    // 1. Sync Playback Rate & Muted to ALL videos (so they are ready to swap instantly)
    useEffect(() => {
        getVideoRefs().forEach(ref => {
            if (ref.current) {
                ref.current.playbackRate = playbackRate;
                // CRITICAL FIX: Force unmute during export. 
                // Browsers (especially Chrome) mute the captureStream if the element is muted.
                // We must allow the element to "play" its audio so the stream picks it up.
                ref.current.muted = isExporting ? false : isMuted;
            }
        });
        if (audioRef.current) {
            audioRef.current.playbackRate = audioPlaybackRate;
            audioRef.current.muted = isExporting ? false : isAudioTrackMuted;
        }
    }, [playbackRate, isMuted, audioPlaybackRate, isAudioTrackMuted, isExporting]);

    // 2. Sync Video Time (Only for the ACTIVE video to avoid fighting)
    // Also ensures inactive videos are paused
    useEffect(() => {
        const refs = {
            intro: introRef.current,
            main: mainRef.current,
            outro: outroRef.current
        };

        // Determine active element
        const activeEl = activeMediaType && activeMediaType !== 'audio' ? refs[activeMediaType] : null;

        // Sync Time for Active Element
        if (activeEl && sourceTime !== null && !activeEl.src.startsWith('color:')) {
            const diff = Math.abs(activeEl.currentTime - sourceTime);
            const currentRate = activeEl.playbackRate || 1;
            
            let driftThreshold;
            
            // CRITICAL: Sync Threshold Logic
            // If the threshold is too low, the video element will constantly trigger 'seeking' 
            // events instead of playing, causing the video to freeze or flash black.
            //
            // Fix: Increased threshold during playback to 0.6s. 
            // This safely covers the React UI update throttle (approx 100-200ms) plus browser 
            // variance, ensuring we only seek if the video is TRULY desynced.
            if (isExporting) {
                // During export, CPU load is high (encoding). We relax the threshold significantly (0.5s)
                // to prevent "Seek Loops" where the video pauses to seek, causing the recorder to 
                // capture frozen frames. The visual timing is driven by the canvas/React state anyway,
                // so as long as the video is roughly keeping up, it looks correct.
                driftThreshold = 0.5; 
            } else if (isPlaying) {
                 driftThreshold = currentRate > 1 ? 1.0 * currentRate : 0.6; // Increased from 0.25
            } else {
                driftThreshold = 0.05; // Tight sync when paused for precision editing
            }

            // Only seek if the video is ready enough (HAVE_METADATA = 1)
            // and the drift is significant.
            if (diff > driftThreshold && activeEl.readyState >= 1) {
                try {
                    // console.log(`Resyncing video: Drift ${diff.toFixed(3)}s > Threshold ${driftThreshold}s`);
                    activeEl.currentTime = sourceTime;
                } catch(e) {
                    // Ignore transient seek errors
                }
            }
        }

        // Pause Inactive Elements to prevent background playing
        Object.entries(refs).forEach(([type, el]) => {
            if (el && type !== activeMediaType && !el.paused) {
                el.pause();
            }
        });

    }, [sourceTime, isPlaying, activeMediaType, isExporting]);

    // 3. Sync Audio Time
    useEffect(() => {
        if (!audioRef.current) return;
        // If no audio source is present/active logic handled by parent, but here we enforce sync
        const audio = audioRef.current;
        if (!audio.src || audio.src === '') {
             // ensure it doesn't play
             if (!audio.paused) audio.pause();
             return;
        }
        
        const diff = Math.abs(audio.currentTime - audioSourceTime);
        const currentRate = audio.playbackRate || 1;
        
        let driftThreshold;
        if (isExporting) {
            driftThreshold = 0.5; // Relaxed for export
        } else if (isPlaying) {
             driftThreshold = currentRate > 1 ? 1.0 * currentRate : 0.6; // Increased from 0.25
        } else {
            driftThreshold = 0.05;
        }

        if (diff > driftThreshold && audio.readyState >= 1) {
            try {
                audio.currentTime = audioSourceTime;
            } catch(e) {}
        }
    }, [audioSourceTime, isPlaying, isExporting]);

    // 4. Play/Pause Control
    useEffect(() => {
        const refs = {
            intro: introRef.current,
            main: mainRef.current,
            outro: outroRef.current
        };
        const activeEl = activeMediaType && activeMediaType !== 'audio' ? refs[activeMediaType] : null;

        if (isPlaying) {
            // Play active video
            if (activeEl && sourceTime !== null && activeEl.readyState >= 2) {
                 activeEl.play().catch(e => {
                    // Ignore abort errors caused by rapid switching
                    if (e.name !== 'AbortError') console.warn("Play failed", e);
                 });
            }
            // Play audio track
            if (audioRef.current && audioRef.current.src) {
                audioRef.current.play().catch(() => {});
            }
        } else {
            // Pause everything
            Object.values(refs).forEach(el => {
                if (el) el.pause();
            });
            if (audioRef.current) audioRef.current.pause();
        }
    }, [isPlaying, activeMediaType, sourceTime]);
};
