/**
 * #23 scoped web cursor polish: click ripples / highlights and optional auto-spotlight,
 * driven only by the in-tab RecordingEvents we already capture (see #22).
 *
 * Deliberately NOT here (Mac/desktop scope): synthetic cursor, cursor skins/size/tilt,
 * smoothing / motion blur, OS-wide tracking, and anything that relies on
 * getDisplayMedia({ cursor: 'never' }). The OS cursor stays baked into the video; ripples
 * are additive rings around it, so there is no double-cursor.
 */
import { Clip, RecordingEvent, SpotlightEffect } from '../types';
import type { RenderCropInfo } from './canvasRenderer';
import { mapSourceToTimeline } from './autoZoom';

/** Seconds a ripple is visible after a click. */
export const CLICK_RIPPLE_DURATION = 0.6;

export interface ActiveClickRipple {
    x: number; // 0-100 of source frame
    y: number;
    /** 0 at click, 1 at end of ripple. */
    progress: number;
}

type ClickEvent = RecordingEvent & { x: number; y: number };

const isClick = (e: RecordingEvent): e is ClickEvent =>
    e.type === 'click' && typeof e.x === 'number' && typeof e.y === 'number';

/** Clicks whose ripple is visible at `sourceTime` (seconds into the main recording). */
export const getActiveClickRipples = (
    events: RecordingEvent[] | null | undefined,
    sourceTime: number,
    duration: number = CLICK_RIPPLE_DURATION
): ActiveClickRipple[] => {
    if (!events || events.length === 0 || !Number.isFinite(sourceTime)) return [];
    const out: ActiveClickRipple[] = [];
    for (const e of events) {
        if (!isClick(e)) continue;
        const dt = sourceTime - e.time;
        if (dt < 0 || dt > duration) continue;
        out.push({ x: e.x, y: e.y, progress: dt / duration });
    }
    return out;
};

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** Map a source-% point through crop/zoom letterboxing to canvas pixels (same math as renderSpotlight). */
export const sourcePointToCanvas = (
    x: number, y: number, canvasWidth: number, canvasHeight: number, cropInfo: RenderCropInfo | null
) => {
    if (cropInfo && cropInfo.shouldCrop) {
        const px = (x - cropInfo.sourceX) / cropInfo.sourceW;
        const py = (y - cropInfo.sourceY) / cropInfo.sourceH;
        return { cx: cropInfo.destX + px * cropInfo.destW, cy: cropInfo.destY + py * cropInfo.destH, scale: 100 / Math.max(1, cropInfo.sourceW) };
    }
    return { cx: (x / 100) * canvasWidth, cy: (y / 100) * canvasHeight, scale: 1 };
};

/** Draw an expanding ring + soft highlight for each active click. Additive; leaves the baked-in cursor visible. */
export const renderClickRipples = (
    ctx: CanvasRenderingContext2D,
    ripples: ActiveClickRipple[],
    canvasWidth: number,
    canvasHeight: number,
    cropInfo: RenderCropInfo | null = null,
    color: string = '255, 200, 60'
) => {
    if (ripples.length === 0) return;
    const base = Math.min(canvasWidth, canvasHeight);
    ctx.save();
    for (const r of ripples) {
        const { cx, cy, scale } = sourcePointToCanvas(r.x, r.y, canvasWidth, canvasHeight, cropInfo);
        const t = easeOutCubic(Math.min(1, Math.max(0, r.progress)));
        const fade = 1 - r.progress;
        const radius = base * (0.012 + 0.045 * t) * Math.min(scale, 3);
        // Highlight disc
        ctx.beginPath();
        ctx.fillStyle = `rgba(${color}, ${0.28 * fade})`;
        ctx.arc(cx, cy, radius * 0.75, 0, Math.PI * 2);
        ctx.fill();
        // Ring
        ctx.beginPath();
        ctx.lineWidth = Math.max(1.5, base * 0.004);
        ctx.strokeStyle = `rgba(${color}, ${0.9 * fade})`;
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.restore();
};

export interface AutoSpotlightOptions {
    /** Seconds before the click the spotlight fades in. */
    leadIn: number;
    /** Seconds it holds after the last click in a group. */
    hold: number;
    /** Clicks closer than this (seconds) merge into one spotlight. */
    mergeGap: number;
    /** Spotlight diameter as % of frame width. */
    size: number;
}

export const DEFAULT_AUTO_SPOTLIGHT_OPTIONS: AutoSpotlightOptions = { leadIn: 0.3, hold: 1.2, mergeGap: 0.8, size: 22 };

const clampPct = (center: number, size: number) => Math.min(Math.max(0, center - size / 2), Math.max(0, 100 - size));

/**
 * Editable spotlight regions (auto: true) centred on in-tab clicks, mapped onto the timeline
 * through main-video clips. Clicks in trimmed-out ranges are skipped. No clicks → [].
 */
export const generateAutoSpotlights = (
    events: RecordingEvent[] | null | undefined,
    clips: Clip[],
    makeId: () => string,
    opts: Partial<AutoSpotlightOptions> = {}
): SpotlightEffect[] => {
    const o = { ...DEFAULT_AUTO_SPOTLIGHT_OPTIONS, ...opts };
    const clicks = (events || []).filter(isClick).slice().sort((a, b) => a.time - b.time);
    const groups: ClickEvent[][] = [];
    for (const c of clicks) {
        const g = groups[groups.length - 1];
        if (g && c.time - g[g.length - 1].time <= o.mergeGap) g.push(c); else groups.push([c]);
    }
    const out: SpotlightEffect[] = [];
    for (const g of groups) {
        const first = mapSourceToTimeline(clips, g[0].time);
        const last = mapSourceToTimeline(clips, g[g.length - 1].time);
        if (first === null || last === null) continue;
        const x = g.reduce((s, c) => s + c.x, 0) / g.length;
        const y = g.reduce((s, c) => s + c.y, 0) / g.length;
        out.push({
            id: makeId(),
            start: Math.max(0, first - o.leadIn),
            end: last + o.hold,
            x: clampPct(x, o.size),
            y: clampPct(y, o.size),
            width: o.size,
            height: o.size,
            shape: 'circle',
            intensity: 0.6,
            auto: true,
        });
    }
    return out;
};

/** Replace previous auto spotlights, keep manual ones. */
export const mergeAutoSpotlights = (existing: SpotlightEffect[], generated: SpotlightEffect[]) =>
    [...existing.filter(s => !s.auto), ...generated];
