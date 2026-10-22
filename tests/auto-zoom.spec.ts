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
      const zooms = m.generateAutoZooms(events, [], 20);
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
      return { zooms: m.generateAutoZooms(events, clips, 13).map(z => [z.start, z.end]), mapped: m.mapSourceToTimeline(clips, 12), cut: m.mapSourceToTimeline(clips, 5) };
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
      };
    });
    expect(r.center).toEqual({ x: 70, y: 50 });
    expect(r.hold).toMatchObject({ x: 45, y: 25, width: 50, height: 50 });
    expect(r.afterLast).toMatchObject({ x: 50, y: 50 }); // clamped to frame
    expect(r.off).toMatchObject({ x: 25, y: 25 });
    expect(r.merged).toEqual(['manual', 'new2']);
  });
});
