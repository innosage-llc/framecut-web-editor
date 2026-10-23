/**
 * Cursor-following auto zoom (issue #22).
 *
 * - generateAutoZooms: click-triggered regions only; cursor moves steer the focal
 *   point inside an active zoom. Soft pacing (~6–8 zooms/min), sensitivity-based
 *   click grouping, dead-zone jitter filter, and ~10–15% framing margin.
 * - getFollowCursorCenter: smoothed cursor position (dead zone kills micro-jitter).
 *
 * Coordinates are percentages (0-100) of the recorded frame, as produced by useScreenRecorder
 * (in-tab only — not OS-wide).
 */
import type { Clip, CursorPoint, RecordingEvent, ZoomEffect } from '../types';
import { generateId } from '../utils';

export interface AutoZoomOptions {
    /** Zoom box size in % of the frame (50 = 2×). Intensity range ~1–3× → size 33–100. */
    zoomSize: number;
    /** Seconds of ease-in lead before the first click of a region. */
    leadIn: number;
    /** Seconds held after the last significant activity, then ease back to 1×. */
    holdAfter: number;
    /**
     * Base temporal merge gap (s) at sensitivity 0.5. Nearby clicks within the
     * sensitivity-scaled gap merge into one longer region.
     */
    mergeGap: number;
    /** Minimum region length (s). */
    minDuration: number;
    /** Cursor-follow smoothing window (s, total width). */
    smoothingWindow: number;
    /**
     * 0–1: how readily nearby clicks become separate zooms.
     * Low = group aggressively (fewer zooms); high = more zooms.
     */
    sensitivity: number;
    /** Ignore cursor deltas smaller than this (% of frame) to kill micro-jitter. */
    deadZone: number;
    /** Framing margin (0.10–0.15): keep surrounding UI in frame by softening crop. */
    marginFraction: number;
    /** Soft cap on auto zooms per minute of timeline (busy demos should not zoom per click). */
    maxZoomsPerMinute: number;
    /** Extend hold while pointer activity continues within this gap (s). */
    activityGap: number;
}

export const DEFAULT_AUTO_ZOOM_OPTIONS: AutoZoomOptions = {
    zoomSize: 50,           // 2× — within the 1.5–2.5× default intensity band
    leadIn: 0.5,
    holdAfter: 1.5,
    mergeGap: 2.5,
    minDuration: 1.2,
    smoothingWindow: 0.6,
    sensitivity: 0.5,
    deadZone: 0.03,         // 3% of frame
    marginFraction: 0.12,   // ~12% framing margin
    maxZoomsPerMinute: 7,   // soft cap in the 6–8 / min band
    activityGap: 1.0,
};

/** Intensity (1–3×) → zoom box size %. */
export const intensityToZoomSize = (intensity: number) => {
    const i = clamp(intensity, 1, 3);
    return 100 / i;
};

/** Zoom box size % → intensity. */
export const zoomSizeToIntensity = (size: number) => 100 / Math.max(1, size);

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const dist = (ax: number, ay: number, bx: number, by: number) =>
    Math.hypot(ax - bx, ay - by);

/** Map a recording (source) time to timeline time through the main-video clips. Null if cut out. */
export const mapSourceToTimeline = (clips: Clip[], sourceTime: number): number | null => {
    const main = clips.filter(c => c.mediaType === 'main');
    if (main.length === 0) return sourceTime;
    for (const c of main) {
        if (sourceTime >= c.sourceStart && sourceTime <= c.sourceEnd) {
            return c.offset + (sourceTime - c.sourceStart) / (c.speed || 1);
        }
    }
    return null;
};

/** Clamp a zoom box's top-left so the box stays inside the frame. */
export const clampBoxOrigin = (center: number, size: number) =>
    clamp(center - size / 2, 0, Math.max(0, 100 - size));

/** Effective merge gap from sensitivity (0 = aggressive merge, 1 = tight/separate). */
export const mergeGapForSensitivity = (baseGap: number, sensitivity: number) => {
    const s = clamp(sensitivity, 0, 1);
    // s=0 → 2.2× base, s=0.5 → base, s=1 → 0.35× base
    const scale = 2.2 - s * 1.85;
    return Math.max(0.4, baseGap * scale);
};

/** Spatial radius (% of frame) for grouping clicks at a given sensitivity. */
export const spatialRadiusForSensitivity = (sensitivity: number) => {
    const s = clamp(sensitivity, 0, 1);
    // Low sensitivity → large spatial merge; high → small
    return 18 - s * 14; // 18% … 4%
};

/**
 * Soften zoom size with framing margin so surrounding UI stays in frame.
 * marginFraction 0.12 with size 50 → ~56 (≈1.8×) — still in the 1.5–2.5× band.
 */
export const applyMarginToZoomSize = (zoomSize: number, marginFraction: number) => {
    const m = clamp(marginFraction, 0, 0.2);
    return clamp(zoomSize * (1 + m), intensityToZoomSize(3), 100);
};

export const generateAutoZooms = (
    events: RecordingEvent[],
    clips: Clip[],
    timelineDuration: number,
    options: Partial<AutoZoomOptions> = {}
): ZoomEffect[] => {
    const opts = { ...DEFAULT_AUTO_ZOOM_OPTIONS, ...options };
    const pointer = events
        .filter(e => (e.type === 'click' || e.type === 'move') && isFiniteNum(e.x) && isFiniteNum(e.y) && isFiniteNum(e.time))
        .sort((a, b) => a.time - b.time);
    const clicks = pointer.filter(e => e.type === 'click');
    if (clicks.length === 0) return [];

    const mergeGap = mergeGapForSensitivity(opts.mergeGap, opts.sensitivity);
    const spatialR = spatialRadiusForSensitivity(opts.sensitivity);
    const zoomSize = applyMarginToZoomSize(opts.zoomSize, opts.marginFraction);

    // Group clicks: temporal + spatial (click-triggered only — moves never start a region).
    const groups: RecordingEvent[][] = [];
    for (const click of clicks) {
        const last = groups[groups.length - 1];
        if (last) {
            const prev = last[last.length - 1];
            const nearInTime = click.time - prev.time < mergeGap;
            const nearInSpace = dist(click.x!, click.y!, prev.x!, prev.y!) <= spatialR;
            if (nearInTime || (nearInSpace && click.time - prev.time < mergeGap * 2)) {
                last.push(click);
                continue;
            }
        }
        groups.push([click]);
    }

    // Soft pacing: merge adjacent groups until under ~maxZoomsPerMinute.
    const durationForCap = timelineDuration > 0
        ? timelineDuration
        : Math.max(clicks[clicks.length - 1].time + opts.holdAfter, 1);
    const maxZooms = Math.max(1, Math.ceil((durationForCap / 60) * opts.maxZoomsPerMinute));
    while (groups.length > maxZooms) {
        // Merge the pair with the smallest temporal gap between last→first click.
        let best = 0;
        let bestGap = Infinity;
        for (let i = 0; i < groups.length - 1; i++) {
            const a = groups[i][groups[i].length - 1];
            const b = groups[i + 1][0];
            const g = b.time - a.time;
            if (g < bestGap) { bestGap = g; best = i; }
        }
        groups[best] = [...groups[best], ...groups[best + 1]];
        groups.splice(best + 1, 1);
    }

    const zooms: ZoomEffect[] = [];
    for (const group of groups) {
        const firstClick = group[0];
        const lastClick = group[group.length - 1];

        // Hold while activity continues (clicks or significant moves), then holdAfter.
        let lastActivity = lastClick.time;
        let lastSigX = lastClick.x!;
        let lastSigY = lastClick.y!;
        for (const e of pointer) {
            if (e.time < lastClick.time) continue;
            if (e.time > lastActivity + opts.activityGap) break;
            if (e.type === 'click') {
                lastActivity = e.time;
                lastSigX = e.x!;
                lastSigY = e.y!;
            } else if (e.type === 'move') {
                if (dist(e.x!, e.y!, lastSigX, lastSigY) >= opts.deadZone * 100) {
                    lastActivity = e.time;
                    lastSigX = e.x!;
                    lastSigY = e.y!;
                }
            }
        }

        const srcStart = Math.max(0, firstClick.time - opts.leadIn);
        const srcEnd = lastActivity + opts.holdAfter;

        const start = mapSourceToTimeline(clips, srcStart) ?? mapSourceToTimeline(clips, firstClick.time);
        let end = mapSourceToTimeline(clips, srcEnd) ?? mapSourceToTimeline(clips, lastClick.time);
        if (start === null || end === null) continue;
        end = Math.min(timelineDuration > 0 ? timelineDuration : end, Math.max(end, start + opts.minDuration));
        if (end - start < opts.minDuration / 2) continue;

        const prev = zooms[zooms.length - 1];
        const s = prev ? Math.max(start, prev.end) : start;
        if (end - s < opts.minDuration / 2) continue;

        const cursorPath: CursorPoint[] = [];
        let lastPath: CursorPoint | null = null;
        for (const e of pointer) {
            if (e.time < srcStart || e.time > srcEnd) continue;
            const t = mapSourceToTimeline(clips, e.time);
            if (t === null || t < s || t > end) continue;
            const x = clamp(e.x!, 0, 100);
            const y = clamp(e.y!, 0, 100);
            // Drop micro-jitter samples from the stored path (dead zone in % points).
            if (lastPath && dist(x, y, lastPath.x, lastPath.y) < opts.deadZone * 100 && e.type === 'move') {
                continue;
            }
            const pt = { time: t, x, y };
            cursorPath.push(pt);
            lastPath = pt;
        }

        zooms.push({
            id: generateId(),
            start: s,
            end,
            x: clampBoxOrigin(firstClick.x!, zoomSize),
            y: clampBoxOrigin(firstClick.y!, zoomSize),
            width: zoomSize,
            height: zoomSize,
            auto: true,
            followCursor: cursorPath.length > 1,
            cursorPath,
        });
    }
    return zooms;
};

/**
 * Smoothed cursor centre for a follow-cursor region at time t.
 * Applies a moving average, then a dead zone so micro-jitter does not nudge the frame.
 */
export const getFollowCursorCenter = (
    zoom: ZoomEffect, time: number, smoothingWindow = DEFAULT_AUTO_ZOOM_OPTIONS.smoothingWindow,
    deadZone = DEFAULT_AUTO_ZOOM_OPTIONS.deadZone
): { x: number; y: number } | null => {
    const path = zoom.cursorPath;
    if (!zoom.followCursor || !path || path.length === 0) return null;
    const threshold = deadZone * 100; // path coords are 0–100

    // Walk the path up to `time`, only advancing the stable point past the dead zone.
    let stable = { x: path[0].x, y: path[0].y };
    for (const p of path) {
        if (p.time > time) break;
        if (dist(p.x, p.y, stable.x, stable.y) >= threshold) {
            stable = { x: p.x, y: p.y };
        }
    }

    const half = smoothingWindow / 2;
    let sx = 0, sy = 0, n = 0;
    for (const p of path) {
        if (p.time < time - half) continue;
        if (p.time > time + half) break;
        sx += p.x; sy += p.y; n++;
    }
    if (n === 0) return stable;
    const raw = { x: sx / n, y: sy / n };
    // Hold stable through micro-jitter inside the dead zone.
    if (dist(raw.x, raw.y, stable.x, stable.y) < threshold) return stable;
    return raw;
};

/** Replace previously auto-generated zooms, keeping manually created/edited ones. */
export const mergeAutoZooms = (existing: ZoomEffect[], generated: ZoomEffect[]): ZoomEffect[] => {
    const manual = existing.filter(z => !z.auto);
    const free = generated.filter(g => !manual.some(m => g.start < m.end && g.end > m.start));
    return [...manual, ...free].sort((a, b) => a.start - b.start);
};

/** Drop only auto-generated regions (repair / Remove Auto Zoom). */
export const removeAutoZooms = (existing: ZoomEffect[]): ZoomEffect[] =>
    existing.filter(z => !z.auto);

/** True when the event list has in-tab click metadata usable for auto zoom. */
export const hasClickMetadata = (events: RecordingEvent[] | null | undefined): boolean =>
    !!events && events.some(e => e.type === 'click' && isFiniteNum(e.x) && isFiniteNum(e.y) && isFiniteNum(e.time));
