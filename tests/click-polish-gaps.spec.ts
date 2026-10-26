/**
 * #23 acceptance gaps on top of #38: visible in-tab limit copy, no auto polish in
 * EXPORT frames for imports without click events (incl. replacing a recording with
 * an import), and no synthetic/double cursor drawn anywhere but the ripple ring.
 */
import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'e2e-black-60s.webm');
const snap = (page: Page) => page.evaluate(() => (window as any).__FRAMECUT_E2E__.getSnapshot());
const tint = (p: number[]) => p[0] + p[1] + p[2];
const GRID: [number, number][] = [];
for (let x = 5; x <= 95; x += 10) for (let y = 5; y <= 95; y += 10) GRID.push([x, y]);

async function load(page: Page, events: any[]) {
  const b64 = fs.readFileSync(FIXTURE).toString('base64');
  await page.evaluate(async ({ b64, events }) => {
    const bin = atob(b64); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    await (window as any).__FRAMECUT_E2E__.loadWithEvents(new Blob([u], { type: 'video/webm' }), events, 60);
  }, { b64, events });
  await page.waitForFunction(() => { const s = (window as any).__FRAMECUT_E2E__?.getSnapshot?.(); return s && s.hasMainVideo && s.duration > 0; }, null, { timeout: 20000 });
}
async function sample(page: Page, t: number, pts: [number, number][]) {
  const r = await page.evaluate(({ t, pts }) => (window as any).__FRAMECUT_E2E__.sampleExportFrame(t, pts), { t, pts });
  return r.pixels as number[][];
}
/** Baseline tint of the plain video far from any click (t=30s, no effects there). */
async function baseline(page: Page) { return Math.max(...(await sample(page, 30, GRID)).map(tint)); }
async function noFrameTint(page: Page) {
  await page.evaluate(() => (window as any).__FRAMECUT_E2E__.setBackgroundFrame({ enabled: false, padding: 0 }));
}

const CLICKS = [
  { type: 'click', time: 2.0, x: 30, y: 40 },
  { type: 'click', time: 10.0, x: 70, y: 60 },
];

test.describe('Click polish gaps (#23)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { (window as any).__FRAMECUT_E2E_ENABLED__ = true; try { localStorage.removeItem('framecut-project-v1'); } catch {} });
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__FRAMECUT_E2E__);
  });

  test('in-app copy states click polish is in-tab only', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await load(page, CLICKS);
    await expect(page.getByTestId('click-polish-limit')).toBeVisible();
    await expect(page.getByTestId('click-polish-limit')).toHaveText(/in-tab clicks only/i);
  });

  test('import without click events: export frames have no ripple/spotlight at any point', async ({ page }) => {
    await load(page, []);
    await noFrameTint(page);
    const s = await snap(page);
    expect(s.recordingEvents.length).toBe(0);
    expect(s.spotlightEffects.length).toBe(0);
    expect(s.zoomEffects.length).toBe(0);
    const base = await baseline(page);
    for (const t of [2.1, 10.1]) {
      const px = await sample(page, t, GRID);
      expect(Math.max(...px.map(tint))).toBeLessThan(base + 10);
    }
  });

  test('replacing a recording with an import drops click polish from export', async ({ page }) => {
    await load(page, CLICKS);
    await page.evaluate(() => (window as any).__FRAMECUT_E2E__.removeAutoZooms());
    await noFrameTint(page);
    const base = await baseline(page);
    const [before] = await sample(page, 2.1, [[30, 40]]);
    expect(tint(before)).toBeGreaterThan(base + 25); // ripple present on the recording
    const b64 = fs.readFileSync(FIXTURE).toString('base64');
    await page.evaluate(async (b64) => {
      const bin = atob(b64); const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      await (window as any).__FRAMECUT_E2E__.uploadMainAsset(new Blob([u], { type: 'video/webm' }), 'import.webm');
    }, b64);
    await expect.poll(async () => (await snap(page)).recordingEvents.length).toBe(0);
    await expect(page.getByRole('button', { name: 'Toggle Click Ripples' })).toBeDisabled();
    await page.waitForFunction(() => (window as any).__FRAMECUT_E2E__.getSnapshot().duration > 0);
    const [after] = await sample(page, 2.1, [[30, 40]]);
    expect(tint(after)).toBeLessThan((await baseline(page)) + 10);
  });

  test('no double cursor: only the ripple ring is drawn, nothing elsewhere; nothing once it fades', async ({ page }) => {
    await load(page, CLICKS);
    await page.evaluate(() => (window as any).__FRAMECUT_E2E__.removeAutoZooms());
    await noFrameTint(page);
    const base = await baseline(page);
    for (const c of CLICKS) {
      const far = GRID.filter(([x, y]) => Math.hypot(x - c.x, (y - c.y) * 9 / 16) > 15);
      const during = await sample(page, c.time + 0.1, [[c.x, c.y], ...far]);
      expect(tint(during[0])).toBeGreaterThan(base + 25);
      expect(Math.max(...during.slice(1).map(tint))).toBeLessThan(base + 10);
      const later = await sample(page, c.time + 1.5, GRID);
      expect(Math.max(...later.map(tint))).toBeLessThan(base + 10);
    }
  });
});
