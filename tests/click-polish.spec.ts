/**
 * Issue #23 — scoped web cursor polish: click ripples/highlights + optional auto-spotlight
 * from in-tab RecordingEvents. No synthetic cursor / skins / smoothing / OS-wide tracking.
 *
 * Uses the existing opt-in __FRAMECUT_E2E__ seam plus the real Upload Video file input.
 * Does not require a visual browser; documents any manual checklist gaps in comments.
 */
import { test, expect, Page } from '@playwright/test';
import type { RecordingEvent } from '../types';
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

async function loadFixtureAsImport(page: Page, durationHint = 60, events: any[] = []) {
  // Empty events = Cap-parity imported MP4 (no click metadata).
  const b64 = fs.readFileSync(FIXTURE).toString('base64');
  await page.evaluate(
    async ({ b64, durationHint, events }) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'video/webm' });
      await (window as any).__FRAMECUT_E2E__.loadWithEvents(blob, events, durationHint);
    },
    { b64, durationHint, events }
  );
  await page.waitForFunction(() => {
    const s = (window as any).__FRAMECUT_E2E__?.getSnapshot?.();
    return s && s.hasMainVideo && s.duration > 0;
  }, null, { timeout: 20000 });
}

const CLICKS: RecordingEvent[] = [
  { type: 'move', time: 1.9, x: 20, y: 25 },
  { type: 'click', time: 2.0, x: 20, y: 25 },
  { type: 'click', time: 2.5, x: 22, y: 27 },
  { type: 'click', time: 20.0, x: 70, y: 40 },
];

const snapshot = (page: Page) => page.evaluate(() => (window as any).__FRAMECUT_E2E__.getSnapshot());

test.describe('Click polish (#23)', () => {
  test.beforeEach(async ({ page }) => {
    await enableE2E(page);
    await page.goto('/');
    await waitForE2E(page);
  });

  test('getActiveClickRipples windows clicks by source time', async ({ page }) => {
    const r = await page.evaluate(async (events) => {
      const m = await import('/utils/clickPolish.ts');
      return {
        before: m.getActiveClickRipples(events, 1.95).length,
        at: m.getActiveClickRipples(events, 2.0),
        overlap: m.getActiveClickRipples(events, 2.55).length,
        after: m.getActiveClickRipples(events, 3.5).length,
        none: m.getActiveClickRipples([], 2).length,
      };
    }, CLICKS);
    expect(r.before).toBe(0);
    expect(r.at).toEqual([{ x: 20, y: 25, progress: 0 }]);
    expect(r.overlap).toBe(2);
    expect(r.after).toBe(0);
    expect(r.none).toBe(0);
  });

  test('renderClickRipples draws at the click point (with crop mapping) and nowhere far away', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const m = await import('/utils/clickPolish.ts');
      const c = document.createElement('canvas'); c.width = 400; c.height = 200;
      const ctx = c.getContext('2d')!;
      m.renderClickRipples(ctx, [{ x: 25, y: 50, progress: 0.2 }], 400, 200, null);
      const near = ctx.getImageData(100, 100, 1, 1).data[3];
      const far = ctx.getImageData(350, 20, 1, 1).data[3];
      ctx.clearRect(0, 0, 400, 200);
      // Zoomed to the left half: source x=25 should land at canvas x=200
      const crop = { shouldCrop: true, sourceX: 0, sourceY: 0, sourceW: 50, sourceH: 100, destX: 0, destY: 0, destW: 400, destH: 200 };
      const p = m.sourcePointToCanvas(25, 50, 400, 200, crop);
      return { near, far, p };
    });
    expect(r.near).toBeGreaterThan(0);
    expect(r.far).toBe(0);
    expect(r.p.cx).toBeCloseTo(200);
    expect(r.p.cy).toBeCloseTo(100);
  });

  test('generateAutoSpotlights groups clicks, maps through trims, keeps manual spotlights', async ({ page }) => {
    const r = await page.evaluate(async (events) => {
      const m = await import('/utils/clickPolish.ts');
      let n = 0; const id = () => 'a' + (n++);
      const full = [{ id: 'm', sourceStart: 0, sourceEnd: 60, offset: 0, speed: 1, mediaType: 'main' }];
      const trimmed = [{ id: 'm', sourceStart: 10, sourceEnd: 60, offset: 0, speed: 1, mediaType: 'main' }];
      const g = m.generateAutoSpotlights(events, full as any, id);
      const t = m.generateAutoSpotlights(events, trimmed as any, id);
      const merged = m.mergeAutoSpotlights([{ id: 'manual', start: 0, end: 1, x: 0, y: 0, width: 10, height: 10 }, { ...g[0], id: 'oldauto' }], g);
      return { g, t, merged: merged.map(s => s.id) };
    }, CLICKS);
    expect(r.g.length).toBe(2);
    expect(r.g[0].auto).toBe(true);
    expect(r.g[0].start).toBeCloseTo(1.7);
    expect(r.g[0].end).toBeCloseTo(3.7);
    expect(r.t.length).toBe(1); // first group trimmed out
    expect(r.t[0].start).toBeCloseTo(10 - 0.3);
    expect(r.merged).toEqual(['manual', r.g[0].id, r.g[1].id]);
  });

  test('recording with in-tab clicks: ripples toggle + Generate Auto Spotlight', async ({ page }) => {
    await loadFixtureAsImport(page, 60, CLICKS);
    const toggle = page.getByRole('button', { name: 'Toggle Click Ripples' });
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect((await snapshot(page)).clickRipplesEnabled).toBe(false);

    await page.getByRole('button', { name: 'Generate Auto Spotlight' }).click();
    await expect.poll(async () => (await snapshot(page)).spotlightEffects.filter((s: any) => s.auto).length).toBe(2);
    // Regenerating replaces, does not duplicate
    await page.getByRole('button', { name: 'Generate Auto Spotlight' }).click();
    await page.waitForTimeout(200);
    expect((await snapshot(page)).spotlightEffects.filter((s: any) => s.auto).length).toBe(2);
  });

  test('imported video without click metadata: click polish disabled', async ({ page }) => {
    await loadFixtureAsImport(page, 60);
    await expect(page.getByRole('button', { name: 'Toggle Click Ripples' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Generate Auto Spotlight' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Generate Auto Spotlight' })).toHaveAttribute('title', /inside this tab/i);
    expect((await snapshot(page)).spotlightEffects.length).toBe(0);
  });
});
