import { test, expect } from '@playwright/test';

test.describe('Background frame helpers', () => {
  test('normalizes persisted data and defaults to no frame', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async () => {
      const m = await import('/utils/backgroundFrame.ts');
      return {
        none: m.normalizeBackgroundFrame(undefined),
        bad: m.normalizeBackgroundFrame({ padding: 9, cornerRadius: -1, shadow: 'x', wallpaper: { kind: 'gradient', id: 'nope' } }),
        badImage: m.normalizeBackgroundFrame({ wallpaper: { kind: 'image', dataUrl: 'javascript:alert(1)' } }).wallpaper.kind,
        good: m.normalizeBackgroundFrame({ padding: 0.1, cornerRadius: 0.05, shadow: 0.5, wallpaper: { kind: 'gradient', id: 'ocean' } }),
        activeDefault: m.isFrameActive(m.DEFAULT_BACKGROUND_FRAME),
        rect: m.getFrameContentRect(1920, 1080, { ...m.DEFAULT_BACKGROUND_FRAME, padding: 0.1 }),
      };
    });
    expect(r.none).toEqual({ wallpaper: { kind: 'color' }, padding: 0, cornerRadius: 0, shadow: 0 });
    expect(r.bad).toEqual({ wallpaper: { kind: 'color' }, padding: 0.25, cornerRadius: 0, shadow: 0 });
    expect(r.badImage).toBe('color');
    expect(r.good).toEqual({ wallpaper: { kind: 'gradient', id: 'ocean' }, padding: 0.1, cornerRadius: 0.05, shadow: 0.5 });
    expect(r.activeDefault).toBe(false);
    expect(r.rect).toEqual({ x: 108, y: 108, width: 1704, height: 864 });
  });

  test('composites content inside padded, rounded frame over wallpaper', async ({ page }) => {
    await page.goto('/');
    const px = await page.evaluate(async () => {
      const m = await import('/utils/backgroundFrame.ts');
      const W = 400, H = 200;
      const frame = { wallpaper: { kind: 'gradient' as const, id: 'slate' }, padding: 0.1, cornerRadius: 0.2, shadow: 0 };
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
});
