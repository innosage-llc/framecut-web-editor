
import { useRef, RefObject } from 'react';
// @ts-ignore
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

// Types for WebCodecs API if not available in environment
declare class AudioEncoder {
    constructor(init: { output: (chunk: EncodedAudioChunk, meta: any) => void, error: (e: any) => void });
    configure(config: { codec: string, numberOfChannels: number, sampleRate: number, bitrate?: number }): void;
    encode(data: AudioData): void;
    flush(): Promise<void>;
    close(): void;
    readonly state: string;
}

declare class EncodedAudioChunk {
    constructor(init: { type: 'key' | 'delta', timestamp: number, duration?: number, data: BufferSource });
    readonly type: 'key' | 'delta';
    readonly timestamp: number;
    readonly duration: number | null;
    readonly byteLength: number;
    copyTo(destination: BufferSource): void;
}

declare class AudioData {
    constructor(init: { format: string, sampleRate: number, numberOfFrames: number, numberOfChannels: number, timestamp: number, data: BufferSource });
    readonly format: string | null;
    readonly sampleRate: number;
    readonly numberOfFrames: number;
    readonly numberOfChannels: number;
    readonly duration: number;
    readonly timestamp: number;
    allocationSize(options: any): number;
    copyTo(destination: BufferSource, options: any): void;
    clone(): AudioData;
    close(): void;
}

interface UseCanvasRecorderProps {
    canvasRef: RefObject<HTMLCanvasElement>;
    introRef: RefObject<HTMLVideoElement>;
    mainRef: RefObject<HTMLVideoElement>;
    outroRef: RefObject<HTMLVideoElement>;
    audioRef: RefObject<HTMLAudioElement>;
    coverImageRef: RefObject<string | null | undefined>;
}

// Shared helper to encode an entire AudioBuffer using an AudioEncoder
const chunkAndEncodeAudio = async (audioBuffer: AudioBuffer, audioEncoder: AudioEncoder) => {
    const numberOfChannels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length;
    const sampleRate = audioBuffer.sampleRate;
    
    // We split into chunks to avoid overwhelming the encoder
    const chunkSize = sampleRate; // 1 second chunks
    
    for (let i = 0; i < length; i += chunkSize) {
        const end = Math.min(i + chunkSize, length);
        const frameLength = end - i;
        const timestamp = (i / sampleRate) * 1_000_000; // microsecond
        
        const planarData = new Float32Array(frameLength * numberOfChannels);
        for (let ch = 0; ch < numberOfChannels; ch++) {
            const channelData = audioBuffer.getChannelData(ch);
            // Copy sub-array
            const sub = channelData.subarray(i, end);
            // Copy to flat buffer (Planar layout: Ch0[...], Ch1[...])
            planarData.set(sub, ch * frameLength);
        }

        const audioData = new AudioData({
            format: 'f32-planar',
            sampleRate,
            numberOfFrames: frameLength,
            numberOfChannels,
            timestamp,
            data: planarData
        });
        
        audioEncoder.encode(audioData);
        audioData.close();
    }
    
    // Flush Audio immediately so we don't hold it in memory
    await audioEncoder.flush();
    audioEncoder.close();
};

export const useCanvasRecorder = ({ canvasRef, introRef, mainRef, outroRef, audioRef, coverImageRef }: UseCanvasRecorderProps) => {
    // Keep refs for legacy MediaRecorder if needed, though mostly replaced by offline
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recordedChunksRef = useRef<Blob[]>([]);
    
    // WebCodecs / MP4 Muxer Refs
    const muxerRef = useRef<any>(null);
    const videoEncoderRef = useRef<VideoEncoder | null>(null);
    const audioEncoderRef = useRef<AudioEncoder | null>(null);

    // Standard Real-time Recording (Legacy stub)
    const startRecording = async (options?: { audioOnly?: boolean; format?: 'mp4' | 'webm' }) => {
        console.warn("startRecording called - this is legacy real-time recording.");
    };

    const stopRecording = async () => {
        return new Blob([]); // Stub
    };

    // --- NEW OFFLINE EXPORT API ---

    const startOfflineSession = async (width: number, height: number, fps: number, audioBuffer: AudioBuffer | null) => {
        // 1. Setup Muxer
        const muxer = new Muxer({
            target: new ArrayBufferTarget(),
            video: {
                codec: 'avc', // H.264
                width,
                height
            },
            audio: audioBuffer ? {
                codec: 'aac',
                numberOfChannels: audioBuffer.numberOfChannels,
                sampleRate: audioBuffer.sampleRate
            } : undefined,
            fastStart: 'in-memory', // optimize for web playback
        });
        muxerRef.current = muxer;

        // 2. Setup Video Encoder
        const videoEncoder = new VideoEncoder({
            output: (chunk: EncodedVideoChunk, meta: any) => muxer.addVideoChunk(chunk, meta),
            error: (e: any) => console.error("VideoEncoder error", e)
        });
        
        // Determine suitable H.264 Level
        const pixelCount = width * height;
        const isHighRes = pixelCount > 2_073_600; // > 1920x1080
        
        // Main Profile (4d), Constraint 00, Level 5.1 (33) or 4.2 (2a)
        const codecString = isHighRes ? 'avc1.4d0033' : 'avc1.4d002a';
        const bitrate = isHighRes ? 12_000_000 : 5_000_000;

        videoEncoder.configure({
            codec: codecString, 
            width,
            height,
            bitrate: bitrate,
            framerate: fps
        });
        videoEncoderRef.current = videoEncoder;

        // 3. Setup Audio Encoder & Encode Immediately
        if (audioBuffer) {
            const audioEncoder = new AudioEncoder({
                output: (chunk: EncodedAudioChunk, meta: any) => muxer.addAudioChunk(chunk, meta),
                error: (e: any) => console.error("AudioEncoder error", e)
            });

            audioEncoder.configure({
                codec: 'mp4a.40.2', // AAC LC
                numberOfChannels: audioBuffer.numberOfChannels,
                sampleRate: audioBuffer.sampleRate,
                bitrate: 128_000
            });
            audioEncoderRef.current = audioEncoder;

            // Reuse shared helper
            await chunkAndEncodeAudio(audioBuffer, audioEncoder);
            
            // Clean up audio encoder ref since it is closed in helper
            audioEncoderRef.current = null;
        }
    };

    const addVideoFrame = async (canvas: HTMLCanvasElement, timestampUs: number, isKeyFrame: boolean) => {
        const encoder = videoEncoderRef.current;
        if (!encoder) return;
        
        if (encoder.state === 'closed') {
            throw new Error("VideoEncoder is closed. The export failed, likely due to unsupported resolution or codec settings.");
        }
        
        const frame = new VideoFrame(canvas, { timestamp: timestampUs });
        try {
            encoder.encode(frame, { keyFrame: isKeyFrame });
        } finally {
            frame.close();
        }
    };

    const finishOfflineSession = async (): Promise<Blob> => {
        // Explicitly flush and close VideoEncoder
        if (videoEncoderRef.current && videoEncoderRef.current.state !== 'closed') {
            await videoEncoderRef.current.flush();
            videoEncoderRef.current.close();
            videoEncoderRef.current = null;
        }
        
        // Ensure audio encoder is closed (it should be)
        if (audioEncoderRef.current && audioEncoderRef.current.state !== 'closed') {
            await audioEncoderRef.current.flush();
            audioEncoderRef.current.close();
            audioEncoderRef.current = null;
        }

        if (muxerRef.current) {
            muxerRef.current.finalize();
            const buffer = muxerRef.current.target.buffer;
            muxerRef.current = null; // Clean up muxer ref
            return new Blob([buffer], { type: 'video/mp4' });
        }
        return new Blob([]);
    };

    // --- AUDIO EXPORT (M4A) ---
    const encodeAudioAsM4a = async (audioBuffer: AudioBuffer): Promise<Blob> => {
        const muxer = new Muxer({
            target: new ArrayBufferTarget(),
            audio: {
                codec: 'aac',
                numberOfChannels: audioBuffer.numberOfChannels,
                sampleRate: audioBuffer.sampleRate
            },
            fastStart: 'in-memory',
        });

        const audioEncoder = new AudioEncoder({
            output: (chunk: EncodedAudioChunk, meta: any) => muxer.addAudioChunk(chunk, meta),
            error: (e: any) => console.error("AudioEncoder error", e)
        });

        audioEncoder.configure({
            codec: 'mp4a.40.2', // AAC LC
            numberOfChannels: audioBuffer.numberOfChannels,
            sampleRate: audioBuffer.sampleRate,
            bitrate: 128_000
        });

        await chunkAndEncodeAudio(audioBuffer, audioEncoder);
        
        muxer.finalize();
        return new Blob([muxer.target.buffer], { type: 'audio/mp4' }); // .m4a is just mp4 audio
    };

    const captureFrame = () => {
        if (canvasRef.current) {
          try {
              return canvasRef.current.toDataURL('image/png');
          } catch (e) {
              console.error("Capture frame failed", e);
              return null;
          }
        }
        return null;
    };

    return {
        startRecording, // Legacy stub
        stopRecording,  // Legacy stub
        captureFrame,
        // New API
        startOfflineSession,
        addVideoFrame,
        finishOfflineSession,
        encodeAudioAsM4a
    };
};