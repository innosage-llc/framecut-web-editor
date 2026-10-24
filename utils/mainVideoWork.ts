/**
 * #26: zoom / spotlight / mosaic (blur) / subtitle timings are authored against the main
 * video. When a different main video is uploaded (not a re-link), they no longer line up.
 */
export interface MainVideoBoundWork {
    zoomEffects?: unknown[];
    spotlightEffects?: unknown[];
    mosaicEffects?: unknown[];
    subtitles?: unknown[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Human summary of effects that replacing the main video would discard, or '' if none. */
export const describeMainVideoBoundWork = (s: MainVideoBoundWork): string => {
    const parts: string[] = [];
    const z = s.zoomEffects?.length ?? 0;
    const sp = s.spotlightEffects?.length ?? 0;
    const m = s.mosaicEffects?.length ?? 0;
    const sub = s.subtitles?.length ?? 0;
    if (z) parts.push(plural(z, 'zoom', 'zooms'));
    if (sp) parts.push(plural(sp, 'spotlight', 'spotlights'));
    if (m) parts.push(plural(m, 'blur', 'blurs'));
    if (sub) parts.push(plural(sub, 'subtitle', 'subtitles'));
    if (parts.length <= 1) return parts.join('');
    return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
};

/** State patch that clears main-video-bound effects and any selection pointing at them. */
export const clearedMainVideoBoundWork = () => ({
    zoomEffects: [] as any[],
    spotlightEffects: [] as any[],
    mosaicEffects: [] as any[],
    subtitles: [] as any[],
    recordingEvents: [] as any[],
    selection: null as any,
});
