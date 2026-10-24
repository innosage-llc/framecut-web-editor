/**
 * GIF export regression: prod v0.2.1 downloaded a GIF whose frames were all identical (preview canvas
 * captured before isExporting committed + export video paused by preview media sync).
 * Drives the real UI export and decodes every frame of the downloaded GIF.
 */
import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'e2e-testsrc-10s.webm'); // 640x360, 10s

async function loadFixture(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => { (window as any).__FRAMECUT_E2E_ENABLED__ = true; try { localStorage.removeItem('framecut-project-v1'); } catch {} });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__FRAMECUT_E2E__);
  const b64 = fs.readFileSync(FIXTURE).toString('base64');
  await page.evaluate(async (b64) => {
    const bin = atob(b64); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    await (window as any).__FRAMECUT_E2E__.loadWithEvents(new Blob([u], { type: 'video/webm' }), [], 10);
  }, b64);
  await page.waitForFunction(() => (window as any).__FRAMECUT_E2E__.getSnapshot().hasMainVideo);
}

/** Decode a GIF in the page with WebCodecs ImageDecoder; returns size, frame count and a hash per frame. */
const decodeGif = (page: Page, bytes: Buffer) => page.evaluate(async (b64) => {
  const bin = atob(b64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const dec = new (window as any).ImageDecoder({ data: u, type: 'image/gif' });
  await dec.tracks.ready;
  const count = dec.tracks.selectedTrack.frameCount;
  const hashes: number[] = [];
  let w = 0, h = 0;
  const c = document.createElement('canvas');
  for (let i = 0; i < count; i++) {
    const { image } = await dec.decode({ frameIndex: i });
    w = image.displayWidth; h = image.displayHeight;
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(image, 0, 0); image.close();
    const d = ctx.getImageData(0, 0, w, h).data;
    let hash = 0;
    for (let k = 0; k < d.length; k += 61) hash = (hash * 31 + d[k]) | 0;
    hashes.push(hash);
  }
  return { count, w, h, hashes };
}, bytes.toString('base64'));

test('GIF export contains ~fps*duration mostly distinct frames at the export size (not preview size)', async ({ page }) => {
  test.setTimeout(180_000);
  await loadFixture(page);
  await page.getByRole('button', { name: /^Export/ }).first().click();
  await page.getByTestId('export-menu-gif').click();
  await page.getByLabel('GIF frame rate').selectOption('10');
  await page.getByLabel('GIF max longest side').selectOption('480');
  const download = page.waitForEvent('download', { timeout: 170_000 });
  await page.getByRole('button', { name: 'Export GIF' }).click();
  const file = await (await download).path();
  const gif = await decodeGif(page, fs.readFileSync(file!));

  expect(gif.count).toBe(100); // 10s @ 10fps
  expect([gif.w, gif.h]).toEqual([480, 270]); // getGifSize(640, 360, 480) — was the preview canvas size
  const distinct = new Set(gif.hashes).size;
  expect(distinct).toBeGreaterThanOrEqual(80); // was 1 (every frame identical)
  expect(gif.hashes[0]).not.toBe(gif.hashes[50]);
  await expect(page.getByText('Exporting...')).toBeHidden();
});
