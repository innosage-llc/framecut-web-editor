/**
 * PROVISIONAL adaptive GIF plan (gifenc streaming): long exports succeed with bounded memory,
 * settings downgrade automatically to fit the browser limit, and the macOS app is suggested
 * when the browser can't do the full project.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { decodeGif, loadFixture, openGifSettings, patchModule } from './helpers/gifExportHelpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_10S = path.join(__dirname, 'fixtures', 'e2e-testsrc-10s.webm');
const FIXTURE_30S = path.join(__dirname, 'fixtures', 'e2e-testsrc-30s-480p.webm'); // 854x480, 30s

test('planGifExport: no downgrade when it fits, ladder when it does not, trim + macOS when even the floor is too big', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const m = await import('/utils/gifPlan.ts');
    return {
      fits: m.planGifExport(854, 480, 30, { fps: 10, maxLongestSide: 480 }),
      long: m.planGifExport(1920, 1080, 120, { fps: 15, maxLongestSide: 1280 }),
      huge: m.planGifExport(1920, 1080, 3600, { fps: 15, maxLongestSide: 1280 }),
      lowMem: m.planGifExport(1920, 1080, 30, { fps: 15, maxLongestSide: 1280 }, { deviceMemoryGB: 1 }),
      warn: m.planGifExport(1920, 1080, 15, { fps: 15, maxLongestSide: 1280 }),
      cap: m.GIF_HARD_MAX_FILE_BYTES,
    };
  });
  expect(r.fits.downgrades).toEqual([]);
  expect([r.fits.width, r.fits.height, r.fits.fps, r.fits.colors, r.fits.duration]).toEqual([480, 270, 10, 256, 30]);
  expect(r.fits.exceedsWebLimits).toBe(false);

  expect(r.long.downgrades.length).toBeGreaterThan(0);
  expect(r.long.estimatedBytes).toBeLessThanOrEqual(r.cap);
  expect(r.long.duration).toBe(120);
  expect(r.long.exceedsWebLimits).toBe(false);

  expect(r.huge.exceedsWebLimits).toBe(true);
  expect(r.huge.duration).toBeLessThan(3600);
  expect([r.huge.fps, Math.max(r.huge.width, r.huge.height), r.huge.colors]).toEqual([5, 320, 64]);
  expect(r.huge.estimatedBytes).toBeLessThanOrEqual(r.cap);

  expect(r.lowMem.hardCapBytes).toBeLessThan(r.cap); // deviceMemory heuristic lowers the cap
  expect(r.lowMem.estimatedBytes).toBeLessThanOrEqual(r.lowMem.hardCapBytes);

  expect(r.warn.warnLarge).toBe(true);
});

test('30s export at 480p streams to a 300-frame GIF with bounded JS heap', async ({ page }) => {
  test.setTimeout(300_000);
  await loadFixture(page, FIXTURE_30S, 30);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const heap = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    return metrics.find(m => m.name === 'JSHeapUsedSize')!.value;
  };
  const baseline = await heap();
  let peak = baseline;
  let sampling = true;
  const sampler = (async () => { while (sampling) { peak = Math.max(peak, await heap()); await page.waitForTimeout(100); } })();

  await openGifSettings(page);
  await page.getByLabel('GIF frame rate').selectOption('10');
  await page.getByLabel('GIF max longest side').selectOption('480');
  await expect(page.getByTestId('gif-downgrades')).toHaveCount(0);
  const download = page.waitForEvent('download', { timeout: 280_000 });
  await page.getByRole('button', { name: 'Export GIF' }).click();
  const file = (await (await download).path())!;
  sampling = false; await sampler;

  const plan = await page.evaluate(() => (window as any).__FRAMECUT_LAST_GIF_PLAN__);
  expect([plan.width, plan.height, plan.fps, plan.duration]).toEqual([480, 270, 10, 30]);
  const gif = await decodeGif(page, fs.readFileSync(file));
  expect(gif.count).toBe(300);
  expect([gif.w, gif.h]).toEqual([480, 270]);
  expect(new Set(gif.hashes).size).toBeGreaterThan(250);
  // Holding all RGBA frames (old gif.js path) would need 300 × 480 × 270 × 4 ≈ 155 MB.
  // Streaming keeps at most GIF_MAX_FRAMES_IN_FLIGHT frames + the encoded output.
  const growthMB = (peak - baseline) / (1024 * 1024);
  console.log(`JS heap growth during 30s GIF export: ${growthMB.toFixed(1)} MB, file ${(fs.statSync(file).size / 1048576).toFixed(1)} MB`);
  expect(growthMB).toBeLessThan(80);
});

test('adaptive downgrade is shown up front and the macOS app is suggested when the browser cannot do the full project', async ({ page }) => {
  test.setTimeout(180_000);
  // Make the estimate pessimistic enough that the 10s fixture needs the full ladder + trimming.
  await patchModule(page, '**/utils/gifPlan.ts*', [
    [/GIF_HARD_MAX_FILE_BYTES\s*=\s*[^;]+;/, 'GIF_HARD_MAX_FILE_BYTES = 4 * 1024 * 1024;'],
    [/GIF_BYTES_PER_PIXEL_FRAME\s*=\s*[^;]+;/, 'GIF_BYTES_PER_PIXEL_FRAME = 1.5;'],
  ]);
  await loadFixture(page, FIXTURE_10S, 10);
  await openGifSettings(page);
  await page.getByLabel('GIF frame rate').selectOption('15');
  await page.getByLabel('GIF max longest side').selectOption('1280');
  await expect(page.getByTestId('gif-downgrades')).toContainText(/frame rate 15 → \d+ fps/);
  await expect(page.getByTestId('gif-downgrades')).toContainText(/palette 256 → (128|64) colours/);
  const suggestion = page.getByTestId('gif-macos-suggestion');
  await expect(suggestion).toBeVisible();
  await expect(suggestion.getByTestId('macos-app-link')).toHaveAttribute('href', '/download/mac');

  const download = page.waitForEvent('download', { timeout: 170_000 });
  await page.getByRole('button', { name: 'Export GIF' }).click();
  const file = (await (await download).path())!;
  const plan = await page.evaluate(() => (window as any).__FRAMECUT_LAST_GIF_PLAN__);
  expect(plan.downgrades.length).toBeGreaterThan(0);
  expect(plan.fps).toBeLessThan(15);
  const gif = await decodeGif(page, fs.readFileSync(file));
  expect([gif.w, gif.h]).toEqual([plan.width, plan.height]);
  expect(gif.count).toBe(Math.ceil(plan.duration * plan.fps));
  expect(fs.statSync(file).size).toBeLessThanOrEqual(plan.hardCapBytes);
  if (plan.exceedsWebLimits) {
    await expect(page.getByTestId('gif-web-limit-prompt')).toContainText(/first \d+s/);
    await expect(page.getByTestId('gif-web-limit-prompt').getByTestId('macos-app-link')).toBeVisible();
  }
  await expect(page.getByText('Exporting...')).toBeHidden();
});
