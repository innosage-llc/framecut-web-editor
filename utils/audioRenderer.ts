
import { Clip, MediaAsset, EditorState } from '../types';
import { getAssetFromDB } from './db';

// Helper to get raw AudioBuffer from an asset
const decodeAsset = async (asset: MediaAsset, ctx: BaseAudioContext): Promise<AudioBuffer | null> => {
    if (asset.src.startsWith('color:') || asset.src.startsWith('image:')) return null;

    try {
        let arrayBuffer: ArrayBuffer | null = null;

        // 1. Try DB
        if (asset.storageId) {
            const blob = await getAssetFromDB(asset.storageId);
            if (blob) arrayBuffer = await blob.arrayBuffer();
        }

        // 2. Try Fetch
        if (!arrayBuffer) {
            const res = await fetch(asset.src);
            arrayBuffer = await res.arrayBuffer();
        }

        if (arrayBuffer) {
            return await ctx.decodeAudioData(arrayBuffer);
        }
    } catch (e) {
        console.warn(`Failed to decode audio for asset ${asset.name}`, e);
    }
    return null;
};

export const renderProjectAudio = async (state: EditorState, sampleRate = 44100): Promise<AudioBuffer | null> => {
    // 1. Calculate dimensions
    const duration = state.duration;
    if (duration <= 0) return null;

    // 2. Create Context
    // Chrome supports up to 2 hours usually, but limit to reasonable size.
    // OfflineAudioContext(numberOfChannels, length, sampleRate)
    const length = Math.ceil(duration * sampleRate);
    const ctx = new OfflineAudioContext(2, length, sampleRate);

    // 3. Gather all clips (Audio and Video tracks)
    const allClips = [...state.clips, ...state.audioClips];
    const assetCache = new Map<string, AudioBuffer>();

    // 4. Decode all unique assets used
    const uniqueAssets = new Set(allClips.map(c => c.mediaType));
    
    for (const type of uniqueAssets) {
        let asset: MediaAsset | null = null;
        if (type === 'intro') asset = state.intro;
        else if (type === 'main') asset = state.mainVideo;
        else if (type === 'outro') asset = state.outro;
        else if (type === 'audio') asset = state.audio;

        if (asset && !assetCache.has(asset.id)) {
            const decoded = await decodeAsset(asset, ctx);
            if (decoded) assetCache.set(asset.id, decoded);
        }
    }

    // 5. Schedule Sources
    for (const clip of allClips) {
        if (clip.muted && clip.mediaType !== 'audio') continue; // Skip muted video clips. Background audio clips don't have 'muted' prop usually, or if they do we respect it.
        
        // Handle explicit track mute for background audio
        if (clip.mediaType === 'audio' && (state as any).isAudioTrackMuted) continue; 

        let asset: MediaAsset | null = null;
        if (clip.mediaType === 'intro') asset = state.intro;
        else if (clip.mediaType === 'main') asset = state.mainVideo;
        else if (clip.mediaType === 'outro') asset = state.outro;
        else if (clip.mediaType === 'audio') asset = state.audio;

        if (asset && assetCache.has(asset.id)) {
            const buffer = assetCache.get(asset.id)!;
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.playbackRate.value = clip.speed;

            // Connect
            source.connect(ctx.destination);

            // Calculation
            // sourceStart: when in the source audio to start playing (seconds)
            // duration: visual duration (how long on timeline)
            // sourceDuration = visualDuration * speed
            
            // source.start(when, offset, duration)
            // when: timeline start time (clip.offset)
            // offset: buffer offset (clip.sourceStart)
            // duration: duration to play (visual duration * speed? No, source duration to play)
            
            const playDuration = clip.sourceEnd - clip.sourceStart;
            
            // Protect against negative starts or out of bounds
            if (clip.offset < duration) {
                try {
                    source.start(clip.offset, clip.sourceStart, playDuration);
                } catch(e) {
                    console.warn("Failed to schedule clip", clip, e);
                }
            }
        }
    }

    // 6. Render
    try {
        const renderedBuffer = await ctx.startRendering();
        return renderedBuffer;
    } catch (e) {
        console.error("Audio Rendering Failed", e);
        return null;
    }
};

// --- WAV Encoding Utilities ---

const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
};

const floatTo16BitPCM = (output: DataView, offset: number, input: Float32Array) => {
    for (let i = 0; i < input.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, input[i]));
        output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
};

const interleave = (input: AudioBuffer) => {
    const totalLength = input.length * input.numberOfChannels;
    const result = new Float32Array(totalLength);
    for (let channel = 0; channel < input.numberOfChannels; channel++) {
        const channelData = input.getChannelData(channel);
        for (let i = 0; i < input.length; i++) {
            result[i * input.numberOfChannels + channel] = channelData[i];
        }
    }
    return result;
};

export const audioBufferToWav = (buffer: AudioBuffer): Blob => {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    
    const samples = interleave(buffer);
    const bufferLength = 44 + samples.length * 2;
    const arrayBuffer = new ArrayBuffer(bufferLength);
    const view = new DataView(arrayBuffer);

    // RIFF identifier
    writeString(view, 0, 'RIFF');
    // RIFF chunk length
    view.setUint32(4, 36 + samples.length * 2, true);
    // RIFF type
    writeString(view, 8, 'WAVE');
    // format chunk identifier
    writeString(view, 12, 'fmt ');
    // format chunk length
    view.setUint32(16, 16, true);
    // sample format (raw)
    view.setUint16(20, format, true);
    // channel count
    view.setUint16(22, numChannels, true);
    // sample rate
    view.setUint32(24, sampleRate, true);
    // byte rate (sample rate * block align)
    view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
    // block align (channel count * bytes per sample)
    view.setUint16(32, numChannels * (bitDepth / 8), true);
    // bits per sample
    view.setUint16(34, bitDepth, true);
    // data chunk identifier
    writeString(view, 36, 'data');
    // data chunk length
    view.setUint32(40, samples.length * 2, true);

    // Write PCM samples
    floatTo16BitPCM(view, 44, samples);

    return new Blob([view], { type: 'audio/wav' });
};
