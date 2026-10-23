import { test, expect } from '@playwright/test';

test.describe('Background frame helpers', () => {
  test('normalizes persisted data and defaults to polished frame on', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async () => {
      const m = await import('/utils/backgroundFrame.ts');
      return {
        none: m.normalizeBackgroundFrame(undefined),
        bad: m.normalizeBackgroundFrame({ padding: 9, cornerRadius: -1, shadow: 'x', wallpaper: { kind: 'gradient', id: 'nope' } }),
        badImage: m.normalizeBackgroundFrame({ wallpaper: { kind: 'image', dataUrl: 'javascript:alert(1)' } }).wallpaper.kind,
        good: m.normalizeBackgroundFrame({ enabled: true, padding: 0.1, cornerRadius: 0.05, shadow: 0.5, wallpaper: { kind: 'gradient', id: 'ocean' } }),
        legacyOff: m.normalizeBackgroundFrame({ wallpaper: { kind: 'color' }, padding: 0, cornerRadius: 0, shadow: 0 }),
        activeDefault: m.isFrameActive(m.DEFAULT_BACKGROUND_FRAME),
        inactiveOff: m.isFrameActive({ ...m.DEFAULT_BACKGROUND_FRAME, enabled: false }),
        rect: m.getFrameContentRect(1920, 1080, m.DEFAULT_BACKGROUND_FRAME),
        softNeutral: m.GRADIENT_PRESETS[0]?.id,
        cornerPx1080: (() => {
          const f = m.DEFAULT_BACKGROUND_FRAME;
          const rect = m.getFrameContentRect(1920, 1080, f);
          return Math.min(rect.width, rect.height) * f.cornerRadius;
        })(),
      };
    });
    expect(r.none).toEqual({
      enabled: true,
      wallpaper: { kind: 'gradient', id: 'soft-neutral' },
      padding: 0.1,
      cornerRadius: 0.02,
      shadow: 0.35,
    });
    expect(r.bad).toEqual({ enabled: true, wallpaper: { kind: 'color' }, padding: 0.25, cornerRadius: 0, shadow: 0 });
    expect(r.badImage).toBe('color');
    expect(r.good).toEqual({ enabled: true, wallpaper: { kind: 'gradient', id: 'ocean' }, padding: 0.1, cornerRadius: 0.05, shadow: 0.5 });
    expect(r.legacyOff).toEqual({ enabled: false, wallpaper: { kind: 'color' }, padding: 0, cornerRadius: 0, shadow: 0 });
    expect(r.activeDefault).toBe(true);
    expect(r.inactiveOff).toBe(false);
    expect(r.rect).toEqual({ x: 108, y: 108, width: 1704, height: 864 });
    expect(r.softNeutral).toBe('soft-neutral');
    // ~2% of shorter content side at 1080p with 10% pad → ~17px (in the 16–24px band)
    expect(r.cornerPx1080).toBeGreaterThanOrEqual(16);
    expect(r.cornerPx1080).toBeLessThanOrEqual(24);
  });

  test('composites content inside padded, rounded frame over wallpaper', async ({ page }) => {
    await page.goto('/');
    const px = await page.evaluate(async () => {
      const m = await import('/utils/backgroundFrame.ts');
      const W = 400, H = 200;
      const frame = { enabled: true, wallpaper: { kind: 'gradient' as const, id: 'slate' }, padding: 0.1, cornerRadius: 0.2, shadow: 0 };
      const content = document.createElement('canvas');
      content.width = 10; content.height = 10;
      const cctx = content.getContext('2d')!;
      cctx.fillStyle = '#ff0000'; cctx.fillRect(0, 0, 10, 10);
      const out = document.createElement('canvas');
      out.width = W; out.height = H;
      const ctx = out.getContext('2d')!;
      const rect = m.getFrameContentRect(W, H, frame);
      m.drawWallpaper(ctx, W, H, frame, '#000000', null);
      m.drawFramedContent(ctx, content, rect, frame);
      const at = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
      return { rect, center: at(W / 2, H / 2), padding: at(5, 5), roundedCorner: at(rect.x + 1, rect.y + 1) };
    });
    expect(px.rect).toEqual({ x: 20, y: 20, width: 360, height: 160 });
    expect(px.center).toEqual([255, 0, 0]);
    expect(px.padding).not.toEqual([255, 0, 0]);
    expect(px.roundedCorner).not.toEqual([255, 0, 0]);
  });

  test('default soft-neutral frame looks polished at common aspect ratios', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async () => {
      const m = await import('/utils/backgroundFrame.ts');
      const sizes = [
        { name: '16:9', w: 1920, h: 1080 },
        { name: '9:16', w: 1080, h: 1920 },
        { name: '1:1', w: 1080, h: 1080 },
      ];
      return sizes.map(({ name, w, h }) => {
        const frame = m.DEFAULT_BACKGROUND_FRAME;
        const rect = m.getFrameContentRect(w, h, frame);
        const shorter = Math.min(w, h);
        const padPx = Math.round(shorter * frame.padding);
        const cornerPx = Math.min(rect.width, rect.height) * frame.cornerRadius;
        return {
          name,
          active: m.isFrameActive(frame),
          wallpaper: frame.wallpaper,
          padFraction: frame.padding,
          padPx,
          cornerPx,
          contentInside: rect.x >= padPx - 1 && rect.y >= padPx - 1
            && rect.x + rect.width <= w - padPx + 1
            && rect.y + rect.height <= h - padPx + 1,
        };
      });
    });
    for (const row of r) {
      expect(row.active, row.name).toBe(true);
      expect(row.wallpaper).toEqual({ kind: 'gradient', id: 'soft-neutral' });
      expect(row.padFraction).toBe(0.1);
      expect(row.cornerPx).toBeGreaterThanOrEqual(16);
      expect(row.cornerPx).toBeLessThanOrEqual(24);
      expect(row.contentInside, row.name).toBe(true);
    }
  });
});
