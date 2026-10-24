/**
 * Export failure must always clear the progress overlay (prod v0.2.1: over-size GIF left the
 * "Exporting..." spinner stuck at ~95%), and GIF encoder worker failures must surface.
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { alerts, loadFixture, openGifSettings, patchModule } from './helpers/gifExportHelpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'e2e-testsrc-10s.webm');
const WORKER_GLOB = '**/workers/gifEncoder.worker.ts*';

test('over-size GIF stops early, clears the spinner and suggests the macOS app', async ({ page }) => {
  test.setTimeout(120_000);
  // Tiny hard cap; tiny bytes-per-pixel estimate so the planner doesn't pre-empt it (the encoder must).
  await patchModule(page, '**/utils/gifPlan.ts*', [
    [/GIF_HARD_MAX_FILE_BYTES\s*=\s*[^;]+;/, 'GIF_HARD_MAX_FILE_BYTES = 30000;'],
    [/GIF_BYTES_PER_PIXEL_FRAME\s*=\s*[^;]+;/, 'GIF_BYTES_PER_PIXEL_FRAME = 0.00001;'],
  ]);
  let downloaded = false;
  page.on('download', () => { downloaded = true; });
  await loadFixture(page, FIXTURE, 10);
  await openGifSettings(page);
  await page.getByRole('button', { name: 'Export GIF' }).click();
  const prompt = page.getByTestId('gif-web-limit-prompt');
  await expect(prompt).toBeVisible({ timeout: 60_000 });
  await expect(prompt).toContainText(/over the .*MB browser limit/);
  await expect(prompt.getByTestId('macos-app-link')).toHaveAttribute('href', '/download/mac');
  await expect(page.getByText('Exporting...')).toBeHidden({ timeout: 5_000 });
  expect(downloaded).toBe(false);
  expect(await alerts(page)).toHaveLength(0);
  await prompt.getByRole('button', { name: 'Close' }).click();
  await expect(prompt).toBeHidden();
});

test('a failing encoder worker surfaces an alert and the spinner clears', async ({ page }) => {
  test.setTimeout(120_000);
  await page.route(WORKER_GLOB, route => route.fulfill({
    contentType: 'text/javascript',
    body: 'self.onmessage = (e) => { if (e.data.type === "frame") throw new Error("encoder boom"); };',
  }));
  await loadFixture(page, FIXTURE, 10);
  await openGifSettings(page);
  await page.getByRole('button', { name: 'Export GIF' }).click();
  await expect.poll(() => alerts(page), { timeout: 60_000 }).toHaveLength(1);
  expect((await alerts(page))[0]).toMatch(/Export failed: GIF encoder worker failed/);
  await expect(page.getByText('Exporting...')).toBeHidden({ timeout: 5_000 });
});

test('a silent (stalled) encoder worker times out instead of hanging forever', async ({ page }) => {
  await page.goto('/');
  const err = await page.evaluate(async () => {
    const { StreamingGifEncoder } = await import('/utils/gifExport.ts');
    const silent = () => new Worker(URL.createObjectURL(new Blob(['self.onmessage = () => {};'], { type: 'text/javascript' })));
    const enc = new StreamingGifEncoder({ width: 16, height: 16, fps: 10, loop: true, stallTimeoutMs: 1500, createWorker: silent });
    try {
      await enc.addFrame(new ImageData(16, 16));
      await enc.finish();
      return 'resolved';
    } catch (e: any) { return `${e.name}: ${e.message}`; }
  });
  expect(err).toMatch(/GifEncodeError: GIF encoding stalled/);
});

test('MP4 export failure also clears the spinner', async ({ page }) => {
  test.setTimeout(120_000);
  await loadFixture(page, FIXTURE, 10);
  await page.evaluate(() => {
    (window as any).VideoEncoder = class { constructor() { throw new Error('encoder unavailable'); } };
  });
  await page.getByRole('button', { name: /^Export/ }).first().click();
  await page.getByRole('button', { name: /MP4/ }).first().click();
  const settings = page.getByRole('button', { name: 'Export MP4' });
  if (await settings.isVisible().catch(() => false)) await settings.click();
  await expect.poll(() => alerts(page), { timeout: 60_000 }).toHaveLength(1);
  expect((await alerts(page))[0]).toMatch(/Export failed/);
  await expect(page.getByText('Exporting...')).toBeHidden({ timeout: 5_000 });
});
