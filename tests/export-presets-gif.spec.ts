import { test, expect } from '@playwright/test';

test.describe('GIF encoder', () => {
  test('produces a GIF the browser decodes with the expected size and colours', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const mod = await import('/utils/gifEncoder.ts');
      const width = 64;
      const height = 32;
      const encoder = new mod.GifEncoder({ width, height, fps: 10, loop: true });
      const makeFrame = (left: [number, number, number], right: [number, number, number]) => {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const c = x < width / 2 ? left : right;
            const o = (y * width + x) * 4;
            data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
          }
        }
        return data;
      };
      encoder.addFrame(makeFrame([255, 0, 0], [0, 0, 255]));
      encoder.addFrame(makeFrame([0, 255, 0], [255, 255, 255]));
      // Noisy frame to exercise LZW dictionary resets (> 4096 codes).
      const noise = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) % 256;
      encoder.addFrame(noise);
      const blob = encoder.finish();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const header = String.fromCharCode(...bytes.slice(0, 6));
      const hasLoop = new TextDecoder().decode(bytes).includes('NETSCAPE2.0');

      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const left = Array.from(ctx.getImageData(5, 5, 1, 1).data.slice(0, 3));
      const right = Array.from(ctx.getImageData(50, 5, 1, 1).data.slice(0, 3));
      return { header, hasLoop, type: blob.type, w: bitmap.width, h: bitmap.height, left, right, frames: encoder.frameCount, size: mod.getGifSize(1920, 1080, 480) };
    });
    expect(result.header).toBe('GIF89a');
    expect(result.type).toBe('image/gif');
    expect(result.hasLoop).toBe(true);
    expect(result.frames).toBe(3);
    expect([result.w, result.h]).toEqual([64, 32]);
    expect(result.left).toEqual([255, 0, 0]);
    expect(result.right).toEqual([0, 0, 255]);
    expect(result.size).toEqual({ width: 480, height: 270 });
  });

  test('noisy frame survives LZW dictionary resets losslessly (after quantization)', async ({ page }) => {
    await page.goto('/');
    const mismatches = await page.evaluate(async () => {
      const mod = await import('/utils/gifEncoder.ts');
      const width = 128, height = 96;
      const data = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < data.length; i++) data[i] = (i % 4 === 3) ? 255 : (i * 2654435761) % 256;
      const enc = new mod.GifEncoder({ width, height, fps: 10, loop: false });
      enc.addFrame(data);
      const bitmap = await createImageBitmap(enc.finish());
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const decoded = ctx.getImageData(0, 0, width, height).data;
      const levels = [6, 7, 6];
      let bad = 0;
      for (let p = 0; p < width * height; p++) {
        for (let c = 0; c < 3; c++) {
          const n = levels[c] - 1;
          const expected = Math.round(Math.round(data[p * 4 + c] * n / 255) * 255 / n);
          if (Math.abs(decoded[p * 4 + c] - expected) > 1) bad++;
        }
      }
      return bad;
    });
    expect(mismatches).toBe(0);
  });

  test('omits the loop extension when loop is off', async ({ page }) => {
    await page.goto('/');
    const hasLoop = await page.evaluate(async () => {
      const mod = await import('/utils/gifEncoder.ts');
      const enc = new mod.GifEncoder({ width: 2, height: 2, fps: 15, loop: false });
      enc.addFrame(new Uint8ClampedArray(16));
      return new TextDecoder().decode(await enc.finish().arrayBuffer()).includes('NETSCAPE2.0');
    });
    expect(hasLoop).toBe(false);
  });
});
