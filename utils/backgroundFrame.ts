/**
 * Background frames (issue #24): wallpaper (gradient / uploaded image / solid colour),
 * padding, rounded corners and drop shadow around the recording.
 *
 * All sizes are stored relative to the canvas so preview and export match at any resolution.
 *
 * Product decisions (Jingtian-approved):
 * - Soft procedural muted-neutral gradient on by default; solid colour also offered.
 * - No licensed/paid wallpaper; user image upload is optional user content only.
 * - Padding ~10% of shorter canvas side; corner radius ~2% of shorter content side
 *   (~16–24px at 1080p); soft drop shadow on by default (toggleable via strength).
 * - Decorative frame stays fixed on the canvas; cursor-follow zoom scales only the
 *   recording content inside the framed window.
 */

export type BackgroundWallpaper =
    | { kind: 'color' } // uses the project's canvasBackgroundColor
    | { kind: 'gradient'; id: string }
    | { kind: 'image'; dataUrl: string };

export interface BackgroundFrame {
    /** When false, preview/export match the unframed editor. */
    enabled: boolean;
    wallpaper: BackgroundWallpaper;
    /** Padding on each side as a fraction of the shorter canvas side (0 – 0.25). */
    padding: number;
    /** Corner radius as a fraction of the shorter content side (0 – 0.25). */
    cornerRadius: number;
    /** Drop shadow strength (0 = none, 1 = strong). Soft default is low blur + low opacity. */
    shadow: number;
}

/**
 * Polished default: frame on with soft muted-neutral gradient, ~10% padding,
 * ~2% corner radius (~17–22px at 1080p with that padding), soft shadow.
 */
export const DEFAULT_BACKGROUND_FRAME: BackgroundFrame = {
    enabled: true,
    wallpaper: { kind: 'gradient', id: 'soft-neutral' },
    padding: 0.1,
    cornerRadius: 0.02,
    shadow: 0.35,
};

/** Explicit off state for the Frame on/off control. */
export const OFF_BACKGROUND_FRAME: BackgroundFrame = {
    enabled: false,
    wallpaper: { kind: 'color' },
    padding: 0,
    cornerRadius: 0,
    shadow: 0,
};

export interface GradientPreset {
    id: string;
    label: string;
    angle: number; // degrees, CSS convention (0 = bottom→top, 90 = left→right)
    stops: string[];
}

/** Built-in set: procedurally generated gradients only (no third-party artwork to license). */
export const GRADIENT_PRESETS: GradientPreset[] = [
    // Default: two muted neutrals for a soft, polished look out of the box.
    { id: 'soft-neutral', label: 'Soft Neutral', angle: 160, stops: ['#3f3f46', '#18181b'] },
    { id: 'ocean', label: 'Ocean', angle: 135, stops: ['#2563eb', '#06b6d4'] },
    { id: 'sunset', label: 'Sunset', angle: 135, stops: ['#f97316', '#db2777'] },
    { id: 'grape', label: 'Grape', angle: 135, stops: ['#7c3aed', '#c026d3'] },
    { id: 'forest', label: 'Forest', angle: 135, stops: ['#059669', '#84cc16'] },
    { id: 'slate', label: 'Slate', angle: 180, stops: ['#334155', '#0f172a'] },
    { id: 'peach', label: 'Peach', angle: 135, stops: ['#fde68a', '#fca5a5'] },
];

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));

/** Normalise possibly-missing / malformed persisted data. */
export const normalizeBackgroundFrame = (raw: unknown): BackgroundFrame => {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_BACKGROUND_FRAME };
    const r = raw as Partial<BackgroundFrame>;
    let wallpaper: BackgroundWallpaper = { kind: 'color' };
    const w = r.wallpaper as BackgroundWallpaper | undefined;
    if (w?.kind === 'gradient' && GRADIENT_PRESETS.some(g => g.id === w.id)) wallpaper = { kind: 'gradient', id: w.id };
    else if (w?.kind === 'image' && typeof w.dataUrl === 'string' && w.dataUrl.startsWith('data:image/')) wallpaper = { kind: 'image', dataUrl: w.dataUrl };
    const padding = clamp(Number(r.padding ?? 0), 0, 0.25);
    const cornerRadius = clamp(Number(r.cornerRadius ?? 0), 0, 0.25);
    const shadow = clamp(Number(r.shadow ?? 0), 0, 1);
    // Pre-enabled-field saves: treat as enabled when any frame setting was non-zero.
    const enabled = typeof r.enabled === 'boolean'
        ? r.enabled
        : (padding > 0 || cornerRadius > 0 || shadow > 0 || wallpaper.kind !== 'color');
    return { enabled, wallpaper, padding, cornerRadius, shadow };
};

export const isFrameActive = (f: BackgroundFrame | undefined | null) =>
    !!f && f.enabled && (f.padding > 0 || f.cornerRadius > 0 || f.shadow > 0);

export interface Rect { x: number; y: number; width: number; height: number }

/** Where the recording sits inside the canvas. Even-sized integers for encoder-friendly scaling. */
export const getFrameContentRect = (canvasWidth: number, canvasHeight: number, frame: BackgroundFrame): Rect => {
    const pad = Math.round(Math.min(canvasWidth, canvasHeight) * clamp(frame.padding, 0, 0.25));
    const width = Math.max(2, Math.floor((canvasWidth - pad * 2) / 2) * 2);
    const height = Math.max(2, Math.floor((canvasHeight - pad * 2) / 2) * 2);
    return { x: Math.round((canvasWidth - width) / 2), y: Math.round((canvasHeight - height) / 2), width, height };
};

const gradientEndpoints = (angleDeg: number, w: number, h: number) => {
    const a = ((angleDeg - 90) * Math.PI) / 180;
    const dx = Math.cos(a), dy = Math.sin(a);
    const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
    return { x0: w / 2 - dx * half, y0: h / 2 - dy * half, x1: w / 2 + dx * half, y1: h / 2 + dy * half };
};

export const gradientCss = (g: GradientPreset) => `linear-gradient(${g.angle}deg, ${g.stops.join(', ')})`;

/** Paint the wallpaper over the whole canvas. Images are drawn "cover" style. */
export const drawWallpaper = (
    ctx: CanvasRenderingContext2D, width: number, height: number,
    frame: BackgroundFrame, fallbackColor: string, image?: HTMLImageElement | null
) => {
    ctx.fillStyle = fallbackColor || '#000000';
    ctx.fillRect(0, 0, width, height);
    const w = frame.wallpaper;
    if (w.kind === 'gradient') {
        const preset = GRADIENT_PRESETS.find(g => g.id === w.id);
        if (!preset) return;
        const { x0, y0, x1, y1 } = gradientEndpoints(preset.angle, width, height);
        const grad = ctx.createLinearGradient(x0, y0, x1, y1);
        preset.stops.forEach((c, i) => grad.addColorStop(preset.stops.length === 1 ? 0 : i / (preset.stops.length - 1), c));
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
    } else if (w.kind === 'image' && image && image.complete && image.naturalWidth > 0) {
        const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
        const dw = image.naturalWidth * scale, dh = image.naturalHeight * scale;
        ctx.drawImage(image, (width - dw) / 2, (height - dh) / 2, dw, dh);
    }
};

const roundRectPath = (ctx: CanvasRenderingContext2D, r: Rect, radius: number) => {
    const rad = Math.min(radius, r.width / 2, r.height / 2);
    ctx.beginPath();
    ctx.moveTo(r.x + rad, r.y);
    ctx.arcTo(r.x + r.width, r.y, r.x + r.width, r.y + r.height, rad);
    ctx.arcTo(r.x + r.width, r.y + r.height, r.x, r.y + r.height, rad);
    ctx.arcTo(r.x, r.y + r.height, r.x, r.y, rad);
    ctx.arcTo(r.x, r.y, r.x + r.width, r.y, rad);
    ctx.closePath();
};

/**
 * Composite the rendered recording (content canvas) into the frame with shadow and rounded corners.
 * The frame (padding / wallpaper / shadow) stays fixed on the outer canvas; zoom applies only to
 * the recording drawn into `content` before this call.
 */
export const drawFramedContent = (
    ctx: CanvasRenderingContext2D, content: CanvasImageSource, rect: Rect, frame: BackgroundFrame
) => {
    const radius = Math.min(rect.width, rect.height) * clamp(frame.cornerRadius, 0, 0.25);
    const shadow = clamp(frame.shadow, 0, 1);
    ctx.save();
    if (shadow > 0) {
        const unit = Math.min(rect.width, rect.height);
        // Soft defaults: low opacity + low blur at the default strength (0.35).
        ctx.shadowColor = `rgba(0, 0, 0, ${0.2 + 0.3 * shadow})`;
        ctx.shadowBlur = unit * 0.06 * shadow;
        ctx.shadowOffsetY = unit * 0.015 * shadow;
        roundRectPath(ctx, rect, radius);
        ctx.fillStyle = '#000000';
        ctx.fill();
    }
    ctx.restore();
    ctx.save();
    roundRectPath(ctx, rect, radius);
    ctx.clip();
    ctx.drawImage(content, rect.x, rect.y, rect.width, rect.height);
    ctx.restore();
};

/** Downscale an uploaded image to keep saved projects (localStorage) small. */
export const imageFileToDataUrl = (file: File, maxSide = 1920, quality = 0.85): Promise<string> =>
    new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(img.naturalWidth * scale));
            c.height = Math.max(1, Math.round(img.naturalHeight * scale));
            c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
            URL.revokeObjectURL(url);
            resolve(c.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
        img.src = url;
    });
