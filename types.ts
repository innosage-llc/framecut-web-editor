
import React from 'react';

export interface Clip {
  id: string;
  sourceStart: number; // Start time in the source video file
  sourceEnd: number;   // End time in the source video file
  offset: number;      // Start time on the timeline
  speed: number;       // Playback speed multiplier (default 1)
  mediaType: 'intro' | 'main' | 'outro' | 'audio'; // Identifies which source asset to use
  muted?: boolean;     // If true, audio is suppressed (used when audio is detached)
  crop?: {             // Global crop for this clip (0-100 percentages)
      x: number;
      y: number;
      width: number;
      height: number;
  };
}

export interface MediaAsset {
  id: string;
  src: string;
  name: string;
  duration: number;
  waveformData?: number[]; // Normalized peaks (0-1) for visualization. ~100 samples per second.
  corsCompatible?: boolean; // Whether the asset supports CORS (required for export/canvas operations)
  storageId?: string; // ID used to retrieve the raw Blob from IndexedDB (persistence key)
}

export interface Subtitle {
  id: string;
  text: string;
  start: number; // Timeline start
  end: number;   // Timeline end
  x?: number;    // Horizontal position percentage (0-100)
  y?: number;    // Vertical position percentage (0-100)
  scale?: number;    // Multiplier (default 1)
  rotation?: number; // Degrees (default 0)
  // Styling
  color?: string;
  backgroundColor?: string;
  fontFamily?: string;
  fontStyle?: 'normal' | 'italic';
  fontWeight?: 'normal' | 'bold';
  fontSize?: number; // Relative size base
  
  // Advanced Styling
  strokeColor?: string;
  strokeWidth?: number; // in pixels relative to font size
  textShadow?: boolean;
  shadowColor?: string;
  shadowBlur?: number;
}

export interface ZoomEffect {
  id: string;
  start: number;
  end: number;
  // Crop Area in Percentages (0-100)
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpotlightEffect {
  id: string;
  start: number;
  end: number;
  // Area in Percentages (0-100)
  x: number;
  y: number;
  width: number;
  height: number;
  intensity?: number;
  shape?: 'circle' | 'rectangle';
}

export interface MosaicPath {
  points: { x: number; y: number }[]; // Coordinates in Percentages (0-100)
  brushSize: number; // Brush size in Percentages relative to canvas min dimension
}

export interface MosaicEffect {
  id: string;
  start: number;
  end: number;
  mode: 'path' | 'box'; // 'path' = drawing, 'box' = geometric shape
  paths: MosaicPath[]; // Used if mode === 'path'
  // Box properties (Used if mode === 'box')
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  shape?: 'rectangle' | 'circle'; 
  blurAmount?: number; // Intensity of blur
}

export interface RecordingEvent {
    type: 'move' | 'click' | 'keydown' | 'window_blur' | 'window_focus';
    time: number; // seconds relative to recording start
    x?: number; // 0-100, only for mouse events
    y?: number; // 0-100, only for mouse events
    key?: string; // e.g. "Enter", "Ctrl", only for keydown
}

export type Selection = 
  | { type: 'clip', id: string } 
  | { type: 'audio', id: string }
  | { type: 'subtitle', id: string } 
  | { type: 'zoom', id: string }
  | { type: 'spotlight', id: string }
  | { type: 'mosaic', id: string }
  | { type: 'crop', id: string } // New selection type for crop editing
  | null;

export interface EditorState {
  // Assets (Sources)
  intro: MediaAsset | null;
  mainVideo: MediaAsset | null;
  outro: MediaAsset | null;
  audio: MediaAsset | null; // Background Audio Asset

  // Timeline State
  duration: number; // Total timeline duration
  currentTime: number; // Global playhead position (Low frequency sync)
  isPlaying: boolean;
  playbackRate: number;
  zoomLevel: number; // pixels per second
  fileName: string | null;
  showDebug: boolean;
  
  // Project Settings
  canvasBackgroundColor: string;
  aspectRatio: number;

  // Track Data (Absolute Global Time)
  clips: Clip[];        // Video Clips
  audioClips: Clip[];   // Audio Clips (Structurally same as Clip but rendered in Audio Track)
  subtitles: Subtitle[];
  zoomEffects: ZoomEffect[];
  spotlightEffects: SpotlightEffect[];
  mosaicEffects: MosaicEffect[];
  selection: Selection;
  
  // Recording Data (Persisted for Magic Edit)
  recordingEvents: RecordingEvent[];

  // Export Settings
  coverImage: string | null; // Base64 or Blob URL for the video thumbnail/poster
}

export interface ExtendedEditorState extends EditorState {
    isExporting: boolean;
    isExportingAudio: boolean;
    isPolishing: boolean; // New: Processing state for magic polish
    currentBrushSize: number;
    exportProgress: number;
    showSuccessToast: boolean;
    toastMessage: string | null; // Dynamic message for the success toast
    isAudioTrackMuted: boolean;
}

export interface PlayerRef {
  startRecording: (options?: { audioOnly?: boolean; format?: 'mp4' | 'webm' }) => Promise<void>;
  stopRecording: () => Promise<Blob>;
  captureFrame: () => string | null;
  seekTo: (time: number) => Promise<void>;
  // New Methods for Offline Export
  renderFrame: () => void;
  getCanvas: () => HTMLCanvasElement | null;
  startOfflineSession: (width: number, height: number, fps: number, audioBuffer: AudioBuffer | null) => Promise<{ width: number; height: number }>;
  addVideoFrame: (canvas: HTMLCanvasElement, timestampUs: number, isKeyFrame: boolean) => Promise<void>;
  finishOfflineSession: () => Promise<Blob>;
  prepareExportCanvas?: (width: number, height: number) => HTMLCanvasElement;
  releaseExportCanvas?: () => void;
  prepareExportPlayback: (clip: Clip | null) => Promise<'video' | 'static' | 'empty'>;
  syncExportPlayback: (sourceTime: number) => Promise<void>;
  stopExportPlayback: () => void;
  // New Method for Hover Preview
  previewSeek: (time: number | null) => void;
  // Audio Export
  encodeAudioAsM4a: (audioBuffer: AudioBuffer) => Promise<Blob>;
}

export interface Dimensions {
  width: number;
  height: number;
}

export const FPS = 30; // Standard frame rate for calculation
export const FRAME_TIME = 1 / FPS;
