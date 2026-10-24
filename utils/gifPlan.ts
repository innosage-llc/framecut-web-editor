/**
 * Adaptive GIF export planning (client-side only, gifenc).
 *
 * PROVISIONAL: every number in this file (size caps, bytes-per-pixel heuristic, downgrade ladder,
 * memory budgets) is a provisional product default pending Jingtian's sign-off. Pro / free tiers are
 * NOT modelled here: they depend on the open licensing decision in #30.
 */

/** PROVISIONAL hard cap on the encoded GIF (the encoder aborts above this). */
export const GIF_HARD_MAX_FILE_BYTES = 50 * 1024 * 1024;
/** PROVISIONAL soft cap: above this the export dialog warns that the file will be large. */
export const GIF_WARN_FILE_BYTES = 15 * 1024 * 1024;
/** Longest output side (px). */
export const GIF_MAX_LONGEST_SIDE = 1280;

/**
 * PROVISIONAL bytes per output pixel per frame for screen recordings with a 256-colour palette
 * (gifenc, per-frame palette, LZW). Measured on UI captures: ~0.05 (static UI) – 0.25 (busy video).
 * 0.15 is a deliberately pessimistic middle so estimates rarely undershoot.
 */
export const GIF_BYTES_PER_PIXEL_FRAME = 0.15;
/** Smaller palettes compress better (shorter LZW codes). Relative to 256 colours. */
const PALETTE_FACTOR: Record<number, number> = { 256: 1, 128: 0.85, 64: 0.72 };

/** PROVISIONAL downgrade ladders, tried in order until the estimate fits. */
export const GIF_FPS_LADDER = [15, 12, 10, 8, 6, 5] as const;
export const GIF_SIDE_LADDER = [1280, 960, 720, 640, 480, 360, 320] as const;
export const GIF_PALETTE_LADDER = [256, 128, 64] as const;
export const GIF_MIN_FPS = 5;
export const GIF_MIN_LONGEST_SIDE = 320;

/** Configurable "get the macOS app" link. Defaults to the in-app download route already used in App.tsx. */
export const MACOS_APP_DOWNLOAD_URL: string =
    ((import.meta as any).env?.VITE_MACOS_APP_DOWNLOAD_URL as string | undefined) || '/download/mac';

export interface DeviceBudget {
    /** navigator.deviceMemory (GB), if exposed. */
    deviceMemoryGB?: number;
    /** performance.memory.jsHeapSizeLimit (bytes), if exposed (Chromium). */
    jsHeapSizeLimit?: number;
}

export const readDeviceBudget = (): DeviceBudget => {
    const nav = typeof navigator !== 'undefined' ? (navigator as any) : {};
    const mem = typeof performance !== 'undefined' ? (performance as any).memory : undefined;
    return {
        deviceMemoryGB: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined,
        jsHeapSizeLimit: typeof mem?.jsHeapSizeLimit === 'number' ? mem.jsHeapSizeLimit : undefined,
    };
};

/**
 * PROVISIONAL effective byte cap for this device. The encoder keeps the whole output in memory
 * (plus one copy when building the Blob), so low-memory devices get a lower cap.
 */
export const effectiveHardCap = (budget: DeviceBudget = {}) => {
    let cap = GIF_HARD_MAX_FILE_BYTES;
    if (budget.deviceMemoryGB !== undefined) cap = Math.min(cap, Math.max(8, budget.deviceMemoryGB * 12) * 1024 * 1024);
    if (budget.jsHeapSizeLimit !== undefined) cap = Math.min(cap, Math.floor(budget.jsHeapSizeLimit * 0.1));
    return Math.max(Math.min(4 * 1024 * 1024, GIF_HARD_MAX_FILE_BYTES), Math.floor(cap));
};

export const getGifSize = (srcWidth: number, srcHeight: number, maxLongestSide: number) => {
    const cap = Math.min(GIF_MAX_LONGEST_SIDE, Math.max(2, maxLongestSide));
    const longest = Math.max(srcWidth, srcHeight);
    const scale = Math.min(1, cap / longest);
    const width = Math.max(2, Math.round((srcWidth * scale) / 2) * 2);
    const height = Math.max(2, Math.round((srcHeight * scale) / 2) * 2);
    return { width, height };
};

export const estimateGifBytes = (width: number, height: number, fps: number, duration: number, colors = 256) =>
    Math.round(width * height * Math.max(1, Math.ceil(duration * fps)) * GIF_BYTES_PER_PIXEL_FRAME * (PALETTE_FACTOR[colors] ?? 1));

export interface GifPlanRequest {
    fps: number;
    maxLongestSide: number;
}

export interface GifPlan {
    width: number;
    height: number;
    fps: number;
    colors: number;
    /** Seconds actually exported (shorter than the project only when even the floor quality can't fit). */
    duration: number;
    estimatedBytes: number;
    hardCapBytes: number;
    /** Human-readable list of automatic downgrades applied (empty = exported as requested). */
    downgrades: string[];
    /** Estimate is above the PROVISIONAL warning size. */
    warnLarge: boolean;
    /** Even the lowest web settings can't fit the whole project: export is trimmed; suggest the macOS app. */
    exceedsWebLimits: boolean;
}

/**
 * Pick the best settings that fit the size/memory budget. Downgrade order (cheapest perceptual cost
 * first for screen recordings): palette 256→128, fps down to 10, resolution, then palette 64, then fps
 * to the 5 fps floor, then resolution to the 320 px floor. If still over, trim the duration.
 */
export const planGifExport = (
    srcWidth: number,
    srcHeight: number,
    duration: number,
    req: GifPlanRequest,
    budget: DeviceBudget = {}
): GifPlan => {
    const hardCap = effectiveHardCap(budget);
    // Target a bit under the cap so the pessimistic estimate leaves headroom.
    const target = hardCap * 0.9;
    const dur = Math.max(0, duration);
    let side = Math.min(req.maxLongestSide, GIF_MAX_LONGEST_SIDE);
    let fps = req.fps;
    let colors = 256;
    const downgrades: string[] = [];
    const size = () => getGifSize(srcWidth, srcHeight, side);
    const est = () => { const s = size(); return estimateGifBytes(s.width, s.height, fps, dur, colors); };

    const steps: Array<() => boolean> = [
        () => { if (colors > 128) { colors = 128; return true; } return false; },
        ...GIF_FPS_LADDER.filter(f => f >= 10).map(f => () => { if (fps > f) { fps = f; return true; } return false; }),
        ...GIF_SIDE_LADDER.filter(s => s >= 480).map(s => () => { if (side > s) { side = s; return true; } return false; }),
        () => { if (colors > 64) { colors = 64; return true; } return false; },
        ...GIF_FPS_LADDER.filter(f => f < 10).map(f => () => { if (fps > f) { fps = f; return true; } return false; }),
        ...GIF_SIDE_LADDER.filter(s => s < 480).map(s => () => { if (side > s) { side = s; return true; } return false; }),
    ];
    const start = { side, fps, colors };
    for (const step of steps) {
        if (est() <= target) break;
        step();
    }
    if (fps !== start.fps) downgrades.push(`frame rate ${start.fps} → ${fps} fps`);
    if (side !== start.side) downgrades.push(`max size ${start.side} → ${side} px`);
    if (colors !== start.colors) downgrades.push(`palette ${start.colors} → ${colors} colours`);

    const { width, height } = size();
    let exportDuration = dur;
    let estimatedBytes = est();
    const exceedsWebLimits = estimatedBytes > target;
    if (exceedsWebLimits) {
        const perSecond = estimateGifBytes(width, height, fps, 1, colors);
        exportDuration = Math.max(1, Math.floor(target / perSecond));
        exportDuration = Math.min(dur, exportDuration);
        estimatedBytes = estimateGifBytes(width, height, fps, exportDuration, colors);
        downgrades.push(`trimmed to first ${exportDuration}s`);
    }
    return {
        width, height, fps, colors,
        duration: exportDuration,
        estimatedBytes,
        hardCapBytes: hardCap,
        downgrades,
        warnLarge: estimatedBytes > GIF_WARN_FILE_BYTES,
        exceedsWebLimits,
    };
};

/** True when the JS heap is close to its limit (Chromium only; elsewhere always false). */
export const isHeapNearLimit = (ratio = 0.85) => {
    const mem = typeof performance !== 'undefined' ? (performance as any).memory : undefined;
    if (!mem?.jsHeapSizeLimit || !mem?.usedJSHeapSize) return false;
    return mem.usedJSHeapSize / mem.jsHeapSizeLimit > ratio;
};
