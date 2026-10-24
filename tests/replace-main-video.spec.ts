/**
 * Issue #26 P2 — replacing the main video clears stale zoom / spotlight / blur /
 * subtitle data (with a confirm first when that would discard work).
 *
 * Uses the existing opt-in __FRAMECUT_E2E__ seam plus the real Upload Video file input.
 * Does not require a visual browser; documents any manual checklist gaps in comments.
 */
import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE = path.join(__dirname, 'fixtures', 'e2e-black-60s.webm');

async function enableE2E(page: Page) {
  await page.addInitScript(() => {
    (window as any).__FRAMECUT_E2E_ENABLED__ = true;
    try { localStorage.removeItem('framecut-project-v1'); } catch {}
  });
}

async function waitForE2E(page: Page) {
  await page.waitForFunction(() => !!(window as any).__FRAMECUT_E2E__);
}

async function loadFixtureAsImport(page: Page, durationHint = 60) {
  // Empty events = Cap-parity imported MP4 (no click metadata).
  const b64 = fs.readFileSync(FIXTURE).toString('base64');
  await page.evaluate(
    async ({ b64, durationHint }) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'video/webm' });
      await (window as any).__FRAMECUT_E2E__.loadWithEvents(blob, [], durationHint);
    },
    { b64, durationHint }
  );
  await page.waitForFunction(() => {
    const s = (window as any).__FRAMECUT_E2E__?.getSnapshot?.();
    return s && s.hasMainVideo && s.duration > 0;
  }, null, { timeout: 20000 });
}

async function uploadReplacement(page: Page) {
  const b64 = fs.readFileSync(FIXTURE).toString('base64');
  await page.evaluate(async (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    await (window as any).__FRAMECUT_E2E__.uploadMainAsset(new Blob([bytes], { type: 'video/webm' }), 'replacement.webm');
  }, b64);
}

const snapshot = (page: Page) => page.evaluate(() => (window as any).__FRAMECUT_E2E__.getSnapshot());

async function addAllEffects(page: Page) {
  await page.getByTitle('Add Zoom Effect').click();
  await page.keyboard.press('Escape');
  await page.getByTitle('Add Spotlight Effect').click();
  await page.getByTitle('Add Blur Effect').click();
  await page.getByTitle('Add Subtitle').click();
  await expect.poll(async () => {
    const s = await snapshot(page);
    return [s.zoomEffects.length, s.spotlightEffects.length, s.mosaicEffects.length, s.subtitles.length].every(n => n > 0);
  }).toBe(true);
}

test.describe('Replace main video clears stale effects (#26 P2)', () => {
  test.beforeEach(async ({ page }) => {
    await enableE2E(page);
    await page.goto('/');
    await waitForE2E(page);
    await loadFixtureAsImport(page, 60);
  });

  test('describeMainVideoBoundWork summarises effects', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const m = await import('/utils/mainVideoWork.ts');
      return [
        m.describeMainVideoBoundWork({}),
        m.describeMainVideoBoundWork({ zoomEffects: [1] }),
        m.describeMainVideoBoundWork({ zoomEffects: [1, 2], spotlightEffects: [1], mosaicEffects: [1], subtitles: [1, 2] }),
      ];
    });
    expect(r).toEqual(['', '1 zoom', '2 zooms, 1 spotlight, 1 blur and 2 subtitles']);
  });

  test('confirm accepted: effects cleared along with recordingEvents', async ({ page }) => {
    await addAllEffects(page);
    const dialogs: string[] = [];
    page.on('dialog', async d => { dialogs.push(d.type() + ':' + d.message()); await d.accept(); });
    await uploadReplacement(page);
    await expect.poll(async () => (await snapshot(page)).zoomEffects.length).toBe(0);
    const s = await snapshot(page);
    expect(s.spotlightEffects.length).toBe(0);
    expect(s.mosaicEffects.length).toBe(0);
    expect(s.subtitles.length).toBe(0);
    expect(s.recordingEvents.length).toBe(0);
    expect(s.hasMainVideo).toBe(true);
    expect(dialogs.length).toBe(1);
    expect(dialogs[0]).toMatch(/^confirm:.*Replacing the main video will remove .*zoom/);
  });

  test('confirm cancelled: nothing changes', async ({ page }) => {
    await addAllEffects(page);
    const before = await snapshot(page);
    page.on('dialog', d => d.dismiss());
    await uploadReplacement(page);
    await page.waitForTimeout(500);
    const after = await snapshot(page);
    expect(after.zoomEffects.length).toBe(before.zoomEffects.length);
    expect(after.spotlightEffects.length).toBe(before.spotlightEffects.length);
    expect(after.mosaicEffects.length).toBe(before.mosaicEffects.length);
    expect(after.subtitles.length).toBe(before.subtitles.length);
  });

  test('no effects: replaces without a confirm', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
    await uploadReplacement(page);
    await page.waitForTimeout(800);
    expect(dialogs).toEqual([]);
    expect((await snapshot(page)).hasMainVideo).toBe(true);
  });
});
