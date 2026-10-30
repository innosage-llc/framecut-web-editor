import { test, expect } from '@playwright/test';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { PINK, CYAN, YELLOW, SCREEN, settle, E2E, callApi, near, boot, loadWithCamera, bubbleCentre, sample, previewPixel } from './helpers/cameraBubbleHelpers';

// #28 PR-C: camera bubble in decoded MP4 / GIF frames, and the export slowdown it costs.
// Chromium and Chrome on Linux have no AAC AudioEncoder, so MP4 export fails here with
// "Unsupported codec type" before any frame is rendered (also without a camera). These tests
// replace AudioEncoder with a no-op so the MP4 is video-only; the video path is unchanged.
const noAacShim = () => {
  (window as any).AudioEncoder = class {
    state = 'unconfigured';
    constructor(_init: any) {}
    configure() { this.state = 'configured'; }
    encode(d: any) { d?.close?.(); }
    async flush() {}
    close() { this.state = 'closed'; }
  };
};

test.beforeEach(async ({ page }) => { await page.addInitScript(noAacShim); });

test.describe('camera bubble in exports', () => {

  test('MP4 and GIF exports contain the bubble (decoded frames)', async ({ page }) => {
    test.setTimeout(240_000);
    await boot(page);
    await loadWithCamera(page, 0.5);
    const s = await E2E(page);
    const centre = await bubbleCentre(page, s.cameraBubbles[0].cameraBubble);

    // MP4 through the real UI.
    await page.getByRole('button', { name: /^Export/ }).first().click();
    await page.getByRole('button', { name: /MP4/ }).first().click();
    const settings = page.getByRole('button', { name: 'Export MP4' });
    const dl = page.waitForEvent('download', { timeout: 200_000 });
    if (await settings.isVisible().catch(() => false)) await settings.click();
    const mp4 = (await (await dl).path())!;
    fs.copyFileSync(mp4, '/workspace/pr28-logs/prc-export.mp4');
    const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', mp4]).toString().trim().split(',').map(Number);
    const [W, H] = probe;
    const px = (t: number) => {
      const x = Math.round(centre[0] / 100 * W), y = Math.round(centre[1] / 100 * H);
      const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 << 20 });
      const o = (y * W + x) * 3;
      return Array.from(raw.subarray(o, o + 3));
    };
    expect(near(px(1.5), PINK, 50)).toBe(true);
    expect(near(px(3.5), CYAN, 50)).toBe(true);
    expect(near(px(5.5), YELLOW, 50)).toBe(true);
    expect(near(px(8.0), YELLOW, 50)).toBe(false); // camera ended (0.5 + 6 = 6.5 s)

    // GIF through the real UI.
    await page.getByRole('button', { name: /^Export/ }).first().click();
    await page.getByTestId('export-menu-gif').click();
    await page.getByLabel('GIF frame rate').selectOption('10');
    await page.getByLabel('GIF max longest side').selectOption('480');
    const gdl = page.waitForEvent('download', { timeout: 200_000 });
    await page.getByRole('button', { name: 'Export GIF' }).click();
    const gifBytes = fs.readFileSync((await (await gdl).path())!);
    const frames = await page.evaluate(async ([b64, centre]) => {
      const bin = atob(b64 as string); const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const dec = new (window as any).ImageDecoder({ data: u, type: 'image/gif' });
      await dec.tracks.ready;
      const out: Record<number, number[]> = {};
      const c = document.createElement('canvas');
      for (const i of [15, 35, 55, 80]) {
        const { image } = await dec.decode({ frameIndex: i });
        c.width = image.displayWidth; c.height = image.displayHeight;
        const ctx = c.getContext('2d')!; ctx.drawImage(image, 0, 0); image.close();
        const [cx, cy] = centre as number[];
        out[i] = Array.from(ctx.getImageData(Math.round(cx / 100 * c.width), Math.round(cy / 100 * c.height), 1, 1).data);
      }
      return out;
    }, [gifBytes.toString('base64'), centre] as const);
    expect(near(frames[15], PINK, 60)).toBe(true);
    expect(near(frames[35], CYAN, 60)).toBe(true);
    expect(near(frames[55], YELLOW, 60)).toBe(true);
    expect(near(frames[80], YELLOW, 60)).toBe(false);
  });

  test('export slowdown from per-frame camera seeks (MP4 + GIF, 10 s project)', async ({ page }) => {
    test.setTimeout(600_000);
    const timeExport = async (withCamera: boolean) => {
      await boot(page);
      if (withCamera) await loadWithCamera(page, 0, 6);
      else {
        const b64 = fs.readFileSync(SCREEN).toString('base64');
        await page.evaluate(async (b64) => {
          const bin = atob(b64); const u = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
          await (window as any).__FRAMECUT_E2E__.loadWithEvents(new Blob([u], { type: 'video/webm' }), [], 10);
        }, b64);
        await page.waitForFunction(() => (window as any).__FRAMECUT_E2E__.getSnapshot().hasMainVideo);
      }
      await page.waitForTimeout(1000);
      await page.getByRole('button', { name: /^Export/ }).first().click();
      await page.getByRole('button', { name: /MP4/ }).first().click();
      const settings = page.getByRole('button', { name: 'Export MP4' });
      const dl = page.waitForEvent('download', { timeout: 280_000 });
      let t0 = Date.now();
      if (await settings.isVisible().catch(() => false)) { t0 = Date.now(); await settings.click(); }
      await dl;
      const mp4 = (Date.now() - t0) / 1000;
      await expect(page.getByText('Exporting...')).toBeHidden({ timeout: 10_000 });
      await page.getByRole('button', { name: /^Export/ }).first().click();
      await page.getByTestId('export-menu-gif').click();
      await page.getByLabel('GIF frame rate').selectOption('10');
      await page.getByLabel('GIF max longest side').selectOption('480');
      const gdl = page.waitForEvent('download', { timeout: 280_000 });
      const g0 = Date.now();
      await page.getByRole('button', { name: 'Export GIF' }).click();
      await gdl;
      return { mp4, gif: (Date.now() - g0) / 1000 };
    };
    const base = await timeExport(false);
    const cam = await timeExport(true);
    const report = { project: '10 s, 640x360 screen + 320x240 camera (camera covers 0-6 s)', base, camera: cam,
      mp4Slowdown: +(cam.mp4 / base.mp4).toFixed(2), gifSlowdown: +(cam.gif / base.gif).toFixed(2) };
    console.log('EXPORT_SLOWDOWN', JSON.stringify(report));
    fs.writeFileSync('/workspace/pr28-logs/prc-export-slowdown.json', JSON.stringify(report, null, 2));
  });
});
