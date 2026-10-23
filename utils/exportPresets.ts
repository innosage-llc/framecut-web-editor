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

/** Product hard limits (Jingtian, #25 follow-up). */
export const GIF_MAX_DURATION_S = 15;
/** Longest side ≤ 1280 px ("720p" product limit). */
export const GIF_MAX_LONGEST_SIDE = 1280;
export const GIF_MAX_FILE_BYTES = 15 * 1024 * 1024;

export interface GifOptions {
    fps: number;
    /** Cap on the longer output side (px), clamped to GIF_MAX_LONGEST_SIDE. */
    maxLongestSide: number;
    loop: boolean;
    /** When the project is longer than GIF_MAX_DURATION_S, export only the first N seconds. */
    trimToMaxDuration: boolean;
}

export const GIF_FPS_OPTIONS = [10, 15] as const;
export const GIF_SIZE_OPTIONS = [480, 720, 960, 1280] as const;
export const DEFAULT_GIF_OPTIONS: GifOptions = {
    fps: 10,
    maxLongestSide: 720,
    loop: true,
    trimToMaxDuration: true,
};

export interface VideoExportSettings {
    format: VideoExportFormat;
    aspectRatio: number;
    gif: GifOptions;
}

export interface GifLimitWarnings {
    needsTrim: boolean;
    needsDownscale: boolean;
    sourceDuration: number;
    sourceLongestSide: number;
    effectiveDuration: number;
    effectiveLongestSide: number;
}

/** Even-sized output dims: scale so the longer side ≤ maxLongestSide (and never upscale). */
export const getGifSize = (srcWidth: number, srcHeight: number, maxLongestSide: number) => {
    const cap = Math.min(GIF_MAX_LONGEST_SIDE, Math.max(2, maxLongestSide));
    const longest = Math.max(srcWidth, srcHeight);
    const scale = Math.min(1, cap / longest);
    const width = Math.max(2, Math.round((srcWidth * scale) / 2) * 2);
    const height = Math.max(2, Math.round((srcHeight * scale) / 2) * 2);
    return { width, height };
};

export const evaluateGifLimits = (
    duration: number,
    srcWidth: number,
    srcHeight: number,
    opts: GifOptions
): GifLimitWarnings => {
    const sourceLongestSide = Math.max(srcWidth, srcHeight);
    const { width, height } = getGifSize(srcWidth, srcHeight, opts.maxLongestSide);
    const needsTrim = duration > GIF_MAX_DURATION_S;
    const needsDownscale = sourceLongestSide > GIF_MAX_LONGEST_SIDE
        || Math.max(width, height) < sourceLongestSide;
    const willTrim = needsTrim && opts.trimToMaxDuration;
    return {
        needsTrim,
        needsDownscale,
        sourceDuration: duration,
        sourceLongestSide,
        // When over length and the user has not accepted trim, keep the raw duration so the UI can block Export.
        effectiveDuration: willTrim || !needsTrim ? Math.min(duration, GIF_MAX_DURATION_S) : duration,
        effectiveLongestSide: Math.max(width, height),
    };
};

export const formatBytes = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};
