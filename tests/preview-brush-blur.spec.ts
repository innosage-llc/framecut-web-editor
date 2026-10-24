/**
 * #26 QA follow-up: brush (path) blur must be visible on the on-screen PREVIEW canvas (not only in
 * export frames), with Background Frame on. Samples canvas.w-full directly.
 */
import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'e2e-testsrc-10s.webm');
const E2E = (page: Page) => page.evaluate(() => (window as any).__FRAMECUT_E2E__.getSnapshot());

/** Preview canvas RGBA at page-px points. */
const previewPixels = (page: Page, pts: [number, number][]) => page.evaluate((pts) => {
  const c = document.querySelector('canvas.w-full') as HTMLCanvasElement;
  const b = c.getBoundingClientRect();
  const ctx = c.getContext('2d')!;
  return pts.map(([px, py]) => Array.from(ctx.getImageData(Math.round((px - b.left) / b.width * c.width), Math.round((py - b.top) / b.height * c.height), 1, 1).data));
}, pts);
const diff = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const lum = (p: number[]) => p[0] + p[1] + p[2];

test('preview shows the video after a paused seek and brush blur strokes render on the preview canvas', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => { (window as any).__FRAMECUT_E2E_ENABLED__ = true; try { localStorage.removeItem('framecut-project-v1'); } catch {} });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__FRAMECUT_E2E__);
  const b64 = fs.readFileSync(FIXTURE).toString('base64');
  await page.evaluate(async (b64) => {
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    await (window as any).__FRAMECUT_E2E__.loadWithEvents(new Blob([bytes], { type: 'video/webm' }), [], 10);
  }, b64);
  await page.waitForFunction(() => (window as any).__FRAMECUT_E2E__.getSnapshot().hasMainVideo);

  // Paused seek into the middle of the clip (QA repro: 2.13s).
  await page.evaluate(() => (window as any).__FRAMECUT_E2E__.seek(2.13));
  // Regression: with nothing else changing, the paused preview must redraw once the seek lands
  // (previously it stayed black/stale because renderFrame bailed while readyState < 2).
  await expect.poll(async () => {
    const c = (await page.locator('canvas.w-full').boundingBox())!;
    return lum((await previewPixels(page, [[c.x + c.width * 0.5, c.y + c.height * 0.5]]))[0]);
  }, { timeout: 5000 }).toBeGreaterThan(60);
  await page.getByTitle('Add Blur Effect').click();
  await page.getByRole('button', { name: 'Brush' }).click();
  await expect.poll(async () => (await E2E(page)).mosaicEffects[0]?.mode).toBe('path');
  const m = (await E2E(page)).mosaicEffects[0];
  expect(m.start).toBeLessThanOrEqual(2.13);
  expect(m.end).toBeGreaterThan(2.13);

  const l = (await page.getByTestId('effect-overlay-layer').boundingBox())!;
  const y = l.y + l.height * 0.5, x0 = l.x + l.width * 0.25, x1 = l.x + l.width * 0.75;
  const SAMPLE: [number, number][] = [[l.x + l.width * 0.5, y], [l.x + l.width * 0.4, y], [l.x + l.width * 0.85, l.y + l.height * 0.12]];
  // The preview must show the actual test pattern (not black) at the seeked frame.
  await expect.poll(async () => lum((await previewPixels(page, SAMPLE))[2]), { timeout: 10000 }).toBeGreaterThan(60);
  const before = await previewPixels(page, SAMPLE);

  await page.mouse.move(x0, y); await page.mouse.down();
  for (let i = 1; i <= 15; i++) await page.mouse.move(x0 + (x1 - x0) * i / 15, y);
  await page.mouse.up();
  await expect.poll(async () => (await E2E(page)).mosaicEffects[0].paths.length).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  const after = await previewPixels(page, SAMPLE);
  // Under the stroke the preview pixels change (blurred); far corner unchanged.
  expect(Math.max(diff(before[0], after[0]), diff(before[1], after[1]))).toBeGreaterThan(30);
  expect(diff(before[2], after[2])).toBeLessThan(20);
});

test('UI flow: click timeline ruler, move over preview, brush blur renders on the preview canvas', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => { (window as any).__FRAMECUT_E2E_ENABLED__ = true; try { localStorage.removeItem('framecut-project-v1'); } catch {} });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__FRAMECUT_E2E__);
  const b64 = fs.readFileSync(FIXTURE).toString('base64');
  await page.evaluate(async (b64) => {
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    await (window as any).__FRAMECUT_E2E__.loadWithEvents(new Blob([bytes], { type: 'video/webm' }), [], 10);
  }, b64);
  await page.waitForFunction(() => (window as any).__FRAMECUT_E2E__.getSnapshot().hasMainVideo);

  // Paused seek into the middle of the clip (QA repro: 2.13s).
  // Seek by clicking the timeline ruler between the 00:02 and 00:04 labels (≈2.1s), like QA did.
  const t2 = (await page.getByText('00:02', { exact: true }).first().boundingBox())!;
  const t4 = (await page.getByText('00:04', { exact: true }).first().boundingBox())!;
  await page.mouse.move(t2.x + (t4.x - t2.x) * 0.065, t2.y + t2.height / 2, { steps: 5 });
  await page.mouse.click(t2.x + (t4.x - t2.x) * 0.065, t2.y + t2.height / 2);
  await page.mouse.move(800, 200, { steps: 5 });
  await expect.poll(async () => (await E2E(page)).currentTime ?? 2.13).toBeGreaterThan(1.5);
  await page.getByTitle('Add Blur Effect').click();
  await page.getByRole('button', { name: 'Brush' }).click();
  await expect.poll(async () => (await E2E(page)).mosaicEffects[0]?.mode).toBe('path');
  const m = (await E2E(page)).mosaicEffects[0];
  expect(m.start).toBeLessThanOrEqual(2.13);
  expect(m.end).toBeGreaterThan(2.13);

  const l = (await page.getByTestId('effect-overlay-layer').boundingBox())!;
  const y = l.y + l.height * 0.5, x0 = l.x + l.width * 0.25, x1 = l.x + l.width * 0.75;
  const SAMPLE: [number, number][] = [[l.x + l.width * 0.5, y], [l.x + l.width * 0.4, y], [l.x + l.width * 0.85, l.y + l.height * 0.12]];
  // The preview must show the actual test pattern (not black) at the seeked frame.
  await expect.poll(async () => lum((await previewPixels(page, SAMPLE))[2]), { timeout: 10000 }).toBeGreaterThan(60);
  const before = await previewPixels(page, SAMPLE);

  await page.mouse.move(x0, y); await page.mouse.down();
  for (let i = 1; i <= 15; i++) await page.mouse.move(x0 + (x1 - x0) * i / 15, y);
  await page.mouse.up();
  await expect.poll(async () => (await E2E(page)).mosaicEffects[0].paths.length).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  const after = await previewPixels(page, SAMPLE);
  // Under the stroke the preview pixels change (blurred); far corner unchanged.
  expect(Math.max(diff(before[0], after[0]), diff(before[1], after[1]))).toBeGreaterThan(30);
  expect(diff(before[2], after[2])).toBeLessThan(20);
});
