export type VideoExportFormat = 'mp4' | 'webm' | 'gif';

export interface AspectPreset {
    id: '16:9' | '9:16' | '1:1';
    label: string;
    hint: string;
    value: number;
}

/** The three ratio presets in scope for issue #25. */
export const ASPECT_PRESETS: AspectPreset[] = [
    { id: '16:9', label: '16:9', hint: 'Landscape (YouTube)', value: 16 / 9 },
    { id: '9:16', label: '9:16', hint: 'Vertical (Reels, TikTok, Shorts)', value: 9 / 16 },
    { id: '1:1', label: '1:1', hint: 'Square (feed posts)', value: 1 },
];

export const findAspectPreset = (ratio: number) =>
    ASPECT_PRESETS.find(p => Math.abs(p.value - ratio) < 0.01) ?? null;

// GIF limits live in ./gifPlan (PROVISIONAL adaptive plan, gifenc). Re-exported for existing callers.
import { GIF_MAX_LONGEST_SIDE, GIF_HARD_MAX_FILE_BYTES, GIF_WARN_FILE_BYTES, getGifSize } from './gifPlan';
export { GIF_MAX_LONGEST_SIDE, GIF_HARD_MAX_FILE_BYTES, GIF_WARN_FILE_BYTES, getGifSize };

export interface GifOptions {
    fps: number;
    /** Cap on the longer output side (px), clamped to GIF_MAX_LONGEST_SIDE. */
    maxLongestSide: number;
    loop: boolean;
}

export const GIF_FPS_OPTIONS = [10, 15] as const;
export const GIF_SIZE_OPTIONS = [480, 720, 960, 1280] as const;
export const DEFAULT_GIF_OPTIONS: GifOptions = {
    fps: 10,
    maxLongestSide: 720,
    loop: true,
};

export interface VideoExportSettings {
    format: VideoExportFormat;
    aspectRatio: number;
    gif: GifOptions;
}

export const formatBytes = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};
