import { test, expect } from '@playwright/test';

test.describe('Auto zoom', () => {
  test('generates merged, non-overlapping follow-cursor regions from clicks', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async () => {
      const m = await import('/utils/autoZoom.ts');
      const events: any[] = [
        { type: 'move', time: 0.8, x: 10, y: 10 },
        { type: 'click', time: 1.0, x: 10, y: 10 },
        { type: 'move', time: 1.5, x: 20, y: 30 },
        { type: 'click', time: 2.0, x: 20, y: 30 }, // within merge gap -> same region
        { type: 'click', time: 8.0, x: 90, y: 90 },
        { type: 'keydown', time: 9.0, key: 'Enter' },
      ];
      // Disable soft pacing so this short fixture keeps both regions.
      const zooms = m.generateAutoZooms(events, [], 20, { maxZoomsPerMinute: 60, marginFraction: 0 });
      return zooms.map(z => ({ start: z.start, end: z.end, x: z.x, y: z.y, w: z.width, auto: z.auto, follow: z.followCursor, n: z.cursorPath?.length }));
    });
    expect(r).toEqual([
      { start: 0.5, end: 3.5, x: 0, y: 0, w: 50, auto: true, follow: true, n: 4 },
      { start: 7.5, end: 9.5, x: 50, y: 50, w: 50, auto: true, follow: false, n: 1 },
    ]);
  });

  test('maps recording time through edited main clips and drops cut-out clicks', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async () => {
      const m = await import('/utils/autoZoom.ts');
      const clips: any[] = [
        { id: 'a', sourceStart: 0, sourceEnd: 3, offset: 0, speed: 1, mediaType: 'main' },
        { id: 'b', sourceStart: 10, sourceEnd: 20, offset: 3, speed: 1, mediaType: 'main' },
      ];
      const events: any[] = [
        { type: 'click', time: 5, x: 50, y: 50 },   // cut out
        { type: 'click', time: 12, x: 50, y: 50 },  // -> timeline 5
      ];
      return { zooms: m.generateAutoZooms(events, clips, 13, { marginFraction: 0, maxZoomsPerMinute: 60 }).map(z => [z.start, z.end]), mapped: m.mapSourceToTimeline(clips, 12), cut: m.mapSourceToTimeline(clips, 5) };
    });
    expect(r.mapped).toBe(5);
    expect(r.cut).toBeNull();
    expect(r.zooms).toEqual([[4.5, 6.5]]);
  });

  test('follow-cursor zoom pans smoothly and stays inside the frame', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async () => {
      const m = await import('/utils/autoZoom.ts');
      const cr = await import('/utils/canvasRenderer.ts');
      const zoom: any = {
        id: 'z', start: 0, end: 10, x: 25, y: 25, width: 50, height: 50, followCursor: true,
        cursorPath: [{ time: 3, x: 30, y: 50 }, { time: 5, x: 70, y: 50 }, { time: 7, x: 99, y: 99 }],
      };
      return {
        hold: cr.calculateZoomRect(zoom, 5),
        afterLast: cr.calculateZoomRect(zoom, 8),
        off: cr.calculateZoomRect({ ...zoom, followCursor: false }, 5),
        center: m.getFollowCursorCenter(zoom, 5),
        merged: m.mergeAutoZooms(
          [{ id: 'manual', start: 0, end: 2, x: 0, y: 0, width: 50, height: 50 }, { id: 'oldAuto', start: 5, end: 6, x: 0, y: 0, width: 50, height: 50, auto: true }],
          [{ id: 'new1', start: 1, end: 3, x: 0, y: 0, width: 50, height: 50, auto: true }, { id: 'new2', start: 4, end: 6, x: 0, y: 0, width: 50, height: 50, auto: true }],
        ).map((z: any) => z.id),
        removed: m.removeAutoZooms([
          { id: 'manual', start: 0, end: 2, x: 0, y: 0, width: 50, height: 50 },
          { id: 'auto', start: 3, end: 4, x: 0, y: 0, width: 50, height: 50, auto: true },
        ]).map((z: any) => z.id),
      };
    });
    expect(r.center).toEqual({ x: 70, y: 50 });
    expect(r.hold).toMatchObject({ x: 45, y: 25, width: 50, height: 50 });
    expect(r.afterLast).toMatchObject({ x: 50, y: 50 }); // clamped to frame
    expect(r.off).toMatchObject({ x: 25, y: 25 });
    expect(r.merged).toEqual(['manual', 'new2']);
    expect(r.removed).toEqual(['manual']);
  });

  test('sensitivity and soft pacing group busy click trains into fewer longer zooms', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async () => {
      const m = await import('/utils/autoZoom.ts');
      // 12 clicks over 60s — one per ~5s. Soft cap ~7/min on a 60s timeline → ≤7 regions.
      const events: any[] = [];
      for (let i = 0; i < 12; i++) {
        events.push({ type: 'click', time: 2 + i * 5, x: 20 + (i % 5) * 10, y: 30 });
      }
      const paced = m.generateAutoZooms(events, [], 60, { sensitivity: 0.2, marginFraction: 0 });
      const sensitive = m.generateAutoZooms(events, [], 60, { sensitivity: 1, maxZoomsPerMinute: 60, marginFraction: 0 });
      return {
        pacedCount: paced.length,
        sensitiveCount: sensitive.length,
        hasClicks: m.hasClickMetadata(events),
        noClicks: m.hasClickMetadata([{ type: 'move', time: 1, x: 1, y: 1 }]),
        gapLow: m.mergeGapForSensitivity(2.5, 0),
        gapHigh: m.mergeGapForSensitivity(2.5, 1),
        sized: m.applyMarginToZoomSize(50, 0.12),
      };
    });
    expect(r.pacedCount).toBeLessThanOrEqual(7);
    expect(r.sensitiveCount).toBeGreaterThan(r.pacedCount);
    expect(r.hasClicks).toBe(true);
    expect(r.noClicks).toBe(false);
    expect(r.gapLow).toBeGreaterThan(r.gapHigh);
    expect(r.sized).toBeCloseTo(56, 5);
  });

  test('dead zone holds the focal point through micro-jitter', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async () => {
      const m = await import('/utils/autoZoom.ts');
      const zoom: any = {
        id: 'z', start: 0, end: 10, x: 25, y: 25, width: 50, height: 50, followCursor: true,
        cursorPath: [
          { time: 1, x: 40, y: 40 },
          { time: 2, x: 40.5, y: 40.2 }, // within ~0.03*100 dead zone of prior
          { time: 4, x: 70, y: 70 },
        ],
      };
      return {
        jitter: m.getFollowCursorCenter(zoom, 2),
        moved: m.getFollowCursorCenter(zoom, 4),
      };
    });
    // At t=2 the smoothed/raw point is near 40.5,40.2 but dead-zone holds prior ~40,40
    expect(r.jitter.x).toBeCloseTo(40, 0);
    expect(r.jitter.y).toBeCloseTo(40, 0);
    expect(r.moved).toEqual({ x: 70, y: 70 });
  });
});
