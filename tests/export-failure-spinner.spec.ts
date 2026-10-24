/**
 * Export failure must always clear the progress overlay (prod v0.2.1: over-size GIF left the
 * "Exporting..." spinner stuck at ~95% after the alert), and gif.js worker failures must surface.
 */
import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'e2e-testsrc-10s.webm');

async function loadFixture(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => {
    (window as any).__FRAMECUT_E2E_ENABLED__ = true;
    try { localStorage.removeItem('framecut-project-v1'); } catch {}
    (window as any).__alerts = [];
    window.alert = (m: any) => { (window as any).__alerts.push(String(m)); };
  });
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

const alerts = (page: Page) => page.evaluate(() => (window as any).__alerts as string[]);

async function exportGif(page: Page) {
  await page.getByRole('button', { name: /^Export/ }).first().click();
  await page.getByTestId('export-menu-gif').click();
  await page.getByRole('button', { name: 'Export GIF' }).click();
}

test('over-size GIF fails fast with an alert and the spinner clears', async ({ page }) => {
  test.setTimeout(120_000);
  // Shrink the product size cap so the fixture's GIF is "too large".
  await page.route('**/utils/exportPresets.ts*', async route => {
    const res = await route.fetch();
    const body = (await res.text()).replace(/GIF_MAX_FILE_BYTES\s*=\s*[^;]+;/, 'GIF_MAX_FILE_BYTES = 20000;');
    await route.fulfill({ response: res, body });
  });
  let downloaded = false;
  page.on('download', () => { downloaded = true; });
  await loadFixture(page);
  await exportGif(page);
  await expect.poll(() => alerts(page), { timeout: 100_000 }).toHaveLength(1);
  expect((await alerts(page))[0]).toMatch(/over the .*MB limit/);
  await expect(page.getByText('Exporting...')).toBeHidden({ timeout: 5_000 });
  expect(downloaded).toBe(false);
  await expect(page.getByRole('button', { name: /^Export/ }).first()).toBeEnabled();
});

test('a failing gif.js worker surfaces an alert and the spinner clears', async ({ page }) => {
  test.setTimeout(120_000);
  await page.route('**/gif.worker.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: 'self.onmessage = () => { throw new Error("encoder boom"); };',
  }));
  await loadFixture(page);
  await exportGif(page);
  await expect.poll(() => alerts(page), { timeout: 60_000 }).toHaveLength(1);
  expect((await alerts(page))[0]).toMatch(/Export failed: GIF encoder worker failed/);
  await expect(page.getByText('Exporting...')).toBeHidden({ timeout: 5_000 });
});

test('a silent (stalled) gif.js worker times out instead of hanging forever', async ({ page }) => {
  await page.route('**/gif.worker.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: 'self.onmessage = () => {};',
  }));
  await page.goto('/');
  const err = await page.evaluate(async () => {
    const { encodeGifWithGifJs } = await import('/utils/gifExport.ts');
    const c = document.createElement('canvas'); c.width = 16; c.height = 16;
    try {
      await encodeGifWithGifJs([{ canvas: c }, { canvas: c }], { width: 16, height: 16, fps: 10, loop: true, stallTimeoutMs: 1500 });
      return 'resolved';
    } catch (e: any) { return `${e.name}: ${e.message}`; }
  });
  expect(err).toMatch(/GifEncodeError: GIF encoding stalled/);
});

test('MP4 export failure also clears the spinner', async ({ page }) => {
  test.setTimeout(120_000);
  await loadFixture(page);
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
