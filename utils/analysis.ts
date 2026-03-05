
import { RecordingEvent, ZoomEffect, SpotlightEffect } from '../types';
import { generateId } from '../utils';

// Thresholds for "Magic Polish"
const SILENCE_THRESHOLD = 0.02; // Roughly -34dB. Signals below this are considered silence.
const MIN_SILENCE_DURATION = 0.5; // Seconds. Ignore silence gaps shorter than this.
const PADDING = 0.1; // Seconds to keep around non-silent audio to avoid cutting words off.

export const analyzeAudioSilence = async (blob: Blob, fallbackDuration: number): Promise<{ start: number; end: number }[]> => {
    try {
        // Validation: Check if blob is valid
        if (!blob || blob.size === 0) {
            console.warn("Audio Analysis: Empty blob provided.");
            return [{ start: 0, end: fallbackDuration }];
        }

        const audioContext = new AudioContext();
        const arrayBuffer = await blob.arrayBuffer();
        
        // Use a wrapper to catch decode errors specifically
        let audioBuffer: AudioBuffer;
        try {
            audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        } catch (decodeError) {
            console.warn("Audio Analysis: decodeAudioData failed (likely no audio track or unsupported codec). Using fallback.", decodeError);
            audioContext.close();
            return [{ start: 0, end: fallbackDuration }];
        }

        const channelData = audioBuffer.getChannelData(0); // Analyze first channel
        const sampleRate = audioBuffer.sampleRate;
        
        const activeRanges: { start: number; end: number }[] = [];
        let isSilence = true;
        let speechStart = 0;
        
        // Loop through samples with a step to improve performance
        const step = Math.floor(sampleRate / 50); // Check 50 times per second
        
        for (let i = 0; i < channelData.length; i += step) {
            const amplitude = Math.abs(channelData[i]);
            const currentTime = i / sampleRate;
            
            if (amplitude > SILENCE_THRESHOLD) {
                if (isSilence) {
                    // Transition from Silence -> Sound
                    isSilence = false;
                    speechStart = Math.max(0, currentTime - PADDING);
                }
            } else {
                if (!isSilence) {
                    // Transition from Sound -> Silence
                    // Look ahead to see if this is just a momentary pause
                    let futureSoundFound = false;
                    const lookaheadSamples = Math.floor(MIN_SILENCE_DURATION * sampleRate);
                    
                    for (let j = 1; j < 10; j++) {
                        const checkIdx = i + (j * (lookaheadSamples / 10));
                        if (checkIdx < channelData.length && Math.abs(channelData[checkIdx]) > SILENCE_THRESHOLD) {
                            futureSoundFound = true;
                            break;
                        }
                    }
                    
                    if (!futureSoundFound) {
                        isSilence = true;
                        activeRanges.push({ start: speechStart, end: currentTime + PADDING });
                    }
                }
            }
        }
        
        // If ended while speaking
        if (!isSilence) {
            activeRanges.push({ start: speechStart, end: audioBuffer.duration });
        }
        
        audioContext.close();
        
        // If no active ranges found (e.g. totally silent video), return the whole clip
        if (activeRanges.length === 0) return [{ start: 0, end: audioBuffer.duration }];
        
        return activeRanges;
    } catch (e) {
        console.error("Audio Analysis General Failure", e);
        // Fallback: Return whole video as one range
        return [{ start: 0, end: fallbackDuration }]; 
    }
};

export const analyzeMousePatterns = (events: RecordingEvent[], totalDuration: number) => {
    const zooms: ZoomEffect[] = [];
    const spotlights: SpotlightEffect[] = [];
    
    // Filter for clicks
    const clicks = events.filter(e => e.type === 'click');
    const moves = events.filter(e => e.type === 'move'); // Pre-filter moves for fuzzy search
    
    console.log(`[Magic Polish] Analyzing ${clicks.length} clicks from ${events.length} total events.`);

    // --- COORDINATE SYSTEM STANDARDIZATION ---
    // We now enforcing that ALL inputs from the recorder MUST be 0-100 percentages.
    const scaleFactor = 1; 

    const ZOOM_SIZE = 50; // 2x magnification (50% of screen)
    const HALF_ZOOM = ZOOM_SIZE / 2;

    clicks.forEach((click, index) => {
        // Debounce: Skip clicks that are too close in time (2 seconds)
        if (index > 0) {
            const prevClick = clicks[index - 1];
            if (click.time - prevClick.time < 2.0) {
                console.log(`[Magic Polish] Skipping Click ${index} (Debounce)`);
                return; 
            }
        }

        const id = generateId();
        const start = Math.max(0, click.time - 0.5);
        const end = Math.min(totalDuration, click.time + 1.5);
        
        let valX = 50;
        let valY = 50;
        let coordsFound = false;

        // 1. Direct Check
        // If coords exist and are not exactly 50/50 (which implies default/marker), use them.
        if (typeof click.x === 'number' && !isNaN(click.x) && typeof click.y === 'number' && !isNaN(click.y)) {
            // Check if it looks like a default value (50.0, 50.0). 
            // Real clicks are rarely EXACTLY 50.00000% unless forced.
            // If it is 50, we attempt fuzzy search to be safe, but can fallback to it.
            if (Math.abs(click.x - 50) > 0.001 || Math.abs(click.y - 50) > 0.001) {
                valX = click.x;
                valY = click.y;
                coordsFound = true;
            }
        }

        // 2. Fuzzy Search Fallback (Timestamp Synchronization)
        // If direct coords are missing or suspicious (50/50), find closest mouse movement.
        if (!coordsFound) {
            // Search window: +/- 500ms
            const timeWindow = 0.5;
            const nearbyMoves = moves.filter(m => Math.abs(m.time - click.time) <= timeWindow);
            
            if (nearbyMoves.length > 0) {
                // Find nearest event in time
                const bestMove = nearbyMoves.reduce((prev, curr) => 
                    Math.abs(curr.time - click.time) < Math.abs(prev.time - click.time) ? curr : prev
                );
                
                if (typeof bestMove.x === 'number' && typeof bestMove.y === 'number') {
                    valX = bestMove.x;
                    valY = bestMove.y;
                    coordsFound = true;
                    console.log(`[Magic Polish] Fuzzy Match: Recovered coords for Click @ ${click.time.toFixed(2)}s from Move @ ${bestMove.time.toFixed(2)}s: (${valX.toFixed(1)}, ${valY.toFixed(1)})`);
                }
            } else {
                console.warn(`[Magic Polish] No fuzzy match found for Click @ ${click.time.toFixed(2)}s. Using center default.`);
            }
        } else {
             console.log(`[Magic Polish] Direct Match: Click @ ${click.time.toFixed(2)}s: (${valX.toFixed(1)}, ${valY.toFixed(1)})`);
        }

        // 2. Apply Scale (Now strictly 1)
        const centerX = valX * scaleFactor;
        const centerY = valY * scaleFactor;
        
        // 3. Calculate Top-Left of Zoom Box to center the click
        // Formula: BoxOrigin = ClickPoint - (BoxSize / 2)
        let boxX = centerX - HALF_ZOOM;
        let boxY = centerY - HALF_ZOOM;
        
        // 4. Unclamped Logic
        const finalBoxX = boxX;
        const finalBoxY = boxY;

        zooms.push({
            id,
            start,
            end,
            x: finalBoxX,
            y: finalBoxY,
            width: ZOOM_SIZE,
            height: ZOOM_SIZE
        });
    });
    
    // 2. Generate Zooms from Idle Hovers (Secondary Priority)
    if (clicks.length < 2) {
        let hoverClusterStart = 0;
        let hoverClusterX = 0;
        let hoverClusterY = 0;
        let clusterCount = 0;
        
        for (let i = 0; i < moves.length; i++) {
            const e = moves[i];
            
            if (clusterCount === 0) {
                hoverClusterStart = e.time;
                hoverClusterX = (e.x || 0) * scaleFactor;
                hoverClusterY = (e.y || 0) * scaleFactor;
                clusterCount = 1;
            } else {
                const cx = (e.x || 0) * scaleFactor;
                const cy = (e.y || 0) * scaleFactor;
                
                const dist = Math.sqrt(Math.pow(cx - hoverClusterX, 2) + Math.pow(cy - hoverClusterY, 2));
                if (dist < 15) { 
                    clusterCount++;
                    hoverClusterX = (hoverClusterX * (clusterCount - 1) + cx) / clusterCount;
                    hoverClusterY = (hoverClusterY * (clusterCount - 1) + cy) / clusterCount;
                    
                    const duration = e.time - hoverClusterStart;
                    if (duration > 2.0 && clusterCount > 30) { 
                        const activeZoom = zooms.find(z => z.end > hoverClusterStart);
                        if (!activeZoom) {
                            const zoomSize = 50; 
                            const halfZoom = zoomSize / 2;
                            zooms.push({
                                id: generateId(),
                                start: hoverClusterStart,
                                end: e.time + 1.0,
                                x: hoverClusterX - halfZoom,
                                y: hoverClusterY - halfZoom,
                                width: zoomSize,
                                height: zoomSize
                            });
                        }
                    }
                } else {
                    clusterCount = 0;
                }
            }
        }
    }

    // 3. Handle Window Focus (Page Switching)
    const focusEvents = events.filter(e => e.type === 'window_focus');
    focusEvents.forEach(evt => {
        const overlaps = zooms.some(z => evt.time >= z.start && evt.time <= z.end);
        if (!overlaps) {
            zooms.push({
                id: generateId(),
                start: evt.time,
                end: Math.min(totalDuration, evt.time + 2.0),
                x: 25, 
                y: 25,
                width: 50, 
                height: 50
            });
        }
    });

    return { zooms, spotlights };
};

export const generateSimulatedEffects = (duration: number) => {
    // Explicitly disabled to aid debugging. Returns empty effects.
    const zooms: ZoomEffect[] = [];
    const spotlights: SpotlightEffect[] = [];
    return { zooms, spotlights };
};
