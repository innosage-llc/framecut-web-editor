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

export interface GifOptions {
    fps: number;
    maxWidth: number;
    loop: boolean;
}

export const GIF_FPS_OPTIONS = [10, 15] as const;
export const GIF_WIDTH_OPTIONS = [320, 480, 640] as const;
export const DEFAULT_GIF_OPTIONS: GifOptions = { fps: 10, maxWidth: 480, loop: true };

export interface VideoExportSettings {
    format: VideoExportFormat;
    aspectRatio: number;
    gif: GifOptions;
}
