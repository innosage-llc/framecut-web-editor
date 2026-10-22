/**
 * Cursor-following auto zoom (issue #22).
 *
 * - generateAutoZooms: turns recorded click/move events into zoom regions (timeline time),
 *   each carrying the cursor path inside it so it can pan with the cursor.
 * - getFollowCursorCenter: smoothed cursor position for a region at a given time.
 *
 * Coordinates are percentages (0-100) of the recorded frame, as produced by useScreenRecorder.
 */
import type { Clip, CursorPoint, RecordingEvent, ZoomEffect } from '../types';
import { generateId } from '../utils';

export interface AutoZoomOptions {
    /** Zoom box size in % of the frame (50 = 2x), same as Magic Polish. */
    zoomSize: number;
    /** Seconds of lead-in before the first click of a region. */
    leadIn: number;
    /** Seconds held after the last click of a region. */
    holdAfter: number;
    /** Clicks closer than this (s) are merged into one region instead of re-zooming. */
    mergeGap: number;
    /** Minimum region length (s). */
    minDuration: number;
    /** Cursor-follow smoothing window (s, total width). */
    smoothingWindow: number;
}

export const DEFAULT_AUTO_ZOOM_OPTIONS: AutoZoomOptions = {
    zoomSize: 50,
    leadIn: 0.5,
    holdAfter: 1.5,
    mergeGap: 2.0,
    minDuration: 1.0,
    smoothingWindow: 0.6,
};

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

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
export const clampBoxOrigin = (center: number, size: number) => clamp(center - size / 2, 0, Math.max(0, 100 - size));

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

    // Group clicks into regions (source time).
    const groups: RecordingEvent[][] = [];
    for (const click of clicks) {
        const last = groups[groups.length - 1];
        if (last && click.time - last[last.length - 1].time < opts.mergeGap) last.push(click);
        else groups.push([click]);
    }

    const zooms: ZoomEffect[] = [];
    for (const group of groups) {
        const srcStart = Math.max(0, group[0].time - opts.leadIn);
        const srcEnd = group[group.length - 1].time + opts.holdAfter;

        // Map to timeline; skip regions whose start/end were cut out by editing.
        const start = mapSourceToTimeline(clips, srcStart) ?? mapSourceToTimeline(clips, group[0].time);
        let end = mapSourceToTimeline(clips, srcEnd) ?? mapSourceToTimeline(clips, group[group.length - 1].time);
        if (start === null || end === null) continue;
        end = Math.min(timelineDuration > 0 ? timelineDuration : end, Math.max(end, start + opts.minDuration));
        if (end - start < opts.minDuration / 2) continue;

        // Don't overlap the previous region.
        const prev = zooms[zooms.length - 1];
        const s = prev ? Math.max(start, prev.end) : start;
        if (end - s < opts.minDuration / 2) continue;

        const cursorPath: CursorPoint[] = [];
        for (const e of pointer) {
            if (e.time < srcStart || e.time > srcEnd) continue;
            const t = mapSourceToTimeline(clips, e.time);
            if (t === null || t < s || t > end) continue;
            cursorPath.push({ time: t, x: clamp(e.x!, 0, 100), y: clamp(e.y!, 0, 100) });
        }

        const first = group[0];
        zooms.push({
            id: generateId(),
            start: s,
            end,
            x: clampBoxOrigin(first.x!, opts.zoomSize),
            y: clampBoxOrigin(first.y!, opts.zoomSize),
            width: opts.zoomSize,
            height: opts.zoomSize,
            auto: true,
            followCursor: cursorPath.length > 1,
            cursorPath,
        });
    }
    return zooms;
};

/**
 * Smoothed cursor centre for a follow-cursor region at time t (moving average over the window,
 * falling back to the nearest point). Null when the region has no usable path.
 */
export const getFollowCursorCenter = (
    zoom: ZoomEffect, time: number, smoothingWindow = DEFAULT_AUTO_ZOOM_OPTIONS.smoothingWindow
): { x: number; y: number } | null => {
    const path = zoom.cursorPath;
    if (!zoom.followCursor || !path || path.length === 0) return null;
    const half = smoothingWindow / 2;
    let sx = 0, sy = 0, n = 0;
    for (const p of path) {
        if (p.time < time - half) continue;
        if (p.time > time + half) break;
        sx += p.x; sy += p.y; n++;
    }
    if (n > 0) return { x: sx / n, y: sy / n };
    // No samples nearby: hold the last known position (or first if before the path).
    let nearest = path[0];
    for (const p of path) {
        if (p.time <= time) nearest = p; else break;
    }
    return { x: nearest.x, y: nearest.y };
};

/** Replace previously auto-generated zooms, keeping manually created/edited ones. */
export const mergeAutoZooms = (existing: ZoomEffect[], generated: ZoomEffect[]): ZoomEffect[] => {
    const manual = existing.filter(z => !z.auto);
    const free = generated.filter(g => !manual.some(m => g.start < m.end && g.end > m.start));
    return [...manual, ...free].sort((a, b) => a.start - b.start);
};
