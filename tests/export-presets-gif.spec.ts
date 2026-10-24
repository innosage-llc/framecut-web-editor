import { test, expect } from '@playwright/test';

test.describe('GIF export presets and limits', () => {
  test('getGifSize respects longest-side cap and never upscales; PROVISIONAL caps', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async () => {
      const m = await import('/utils/exportPresets.ts');
      return {
        landscape: m.getGifSize(1920, 1080, 1280),
        portrait: m.getGifSize(1080, 1920, 1280),
        alreadySmall: m.getGifSize(640, 360, 1280),
        capped: m.getGifSize(1920, 1080, 9999),
        limits: { side: m.GIF_MAX_LONGEST_SIDE, hard: m.GIF_HARD_MAX_FILE_BYTES, warn: m.GIF_WARN_FILE_BYTES },
      };
    });
    expect(r.limits).toEqual({ side: 1280, hard: 50 * 1024 * 1024, warn: 15 * 1024 * 1024 });
    expect(r.landscape).toEqual({ width: 1280, height: 720 });
    expect(r.portrait).toEqual({ width: 720, height: 1280 });
    expect(r.alreadySmall).toEqual({ width: 640, height: 360 });
    expect(r.capped).toEqual({ width: 1280, height: 720 });
  });

  test('gifenc streaming encoder produces a GIF the browser can decode', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const { StreamingGifEncoder } = await import('/utils/gifExport.ts');
      const width = 64, height = 32;
      const enc = new StreamingGifEncoder({ width, height, fps: 10, loop: true });
      for (const color of ['#ff0000', '#0000ff']) {
        const c = document.createElement('canvas');
        c.width = width; c.height = height;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, width, height);
        await enc.addFrame(ctx.getImageData(0, 0, width, height));
      }
      const blob = await enc.finish();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const header = String.fromCharCode(...bytes.slice(0, 6));
      const hasLoop = new TextDecoder().decode(bytes).includes('NETSCAPE2.0');
      const dec = new (window as any).ImageDecoder({ data: bytes, type: 'image/gif' });
      await dec.tracks.ready;
      return { header, hasLoop, type: blob.type, frames: dec.tracks.selectedTrack.frameCount };
    });
    expect(result.header).toBe('GIF89a');
    expect(result.type).toBe('image/gif');
    expect(result.hasLoop).toBe(true);
    expect(result.frames).toBe(2);
  });
});
