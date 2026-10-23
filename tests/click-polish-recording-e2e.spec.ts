/**
 * #23 evidence (QA follow-up): mocked getDisplayMedia (same approach as #35's auto-zoom E2E) +
 * real in-tab pointer clicks → recording → click ripples rendered at the click points in the
 * EXPORT renderer (the exact frame path the exporter encodes), Auto Spotlight regions, toggle off.
 *
 * Pixel checks use the export renderer because in headless Chromium the on-screen preview canvas
 * shows video content as black (pre-existing, also on main 305e2a0).
 */
import { test, expect, Page } from '@playwright/test';

const snap = (page: Page) => page.evaluate(() => (window as any).__FRAMECUT_E2E__.getSnapshot());

async function mockDisplayMedia(page: Page) {
  await page.addInitScript(() => {
    (window as any).__FRAMECUT_E2E_ENABLED__ = true;
    try { localStorage.removeItem('framecut-project-v1'); } catch {}
    navigator.mediaDevices.getDisplayMedia = async (constraints?: any) => {
      (window as any).__lastDisplayMediaConstraints = constraints;
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 360;
      const ctx = canvas.getContext('2d')!;
      const draw = () => { ctx.fillStyle = '#111827'; ctx.fillRect(0, 0, 640, 360); requestAnimationFrame(draw); };
      draw();
      return canvas.captureStream(15);
    };
  });
}

/** Sample export-frame RGBA at source-% points (mapped through the padded frame rect). */
async function sampleAtSourcePct(page: Page, t: number, pts: [number, number][]) {
  return page.evaluate(async ([t, pts]: any) => {
    const m = await import('/utils/backgroundFrame.ts');
    const e2e = (window as any).__FRAMECUT_E2E__;
    const W = 640, H = 360;
    const f = e2e.getSnapshot().backgroundFrame;
    const r = m.isFrameActive(f) ? m.getFrameContentRect(W, H, f) : { x: 0, y: 0, width: W, height: H };
    const mapped = pts.map(([x, y]: number[]) => [((r.x + x / 100 * r.width) / W) * 100, ((r.y + y / 100 * r.height) / H) * 100]);
    return (await e2e.sampleExportFrame(t, mapped, W, H)).pixels as number[][];
  }, [t, pts]);
}

/** Yellow tint over the dark mocked screen: red channel up relative to blue. */
const tint = (p: number[]) => p[0] - p[2];

test('recorded in-tab clicks → ripples at click points in export frames, Auto Spotlight, toggle off', async ({ page }) => {
  test.setTimeout(90000);
  await mockDisplayMedia(page);
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__FRAMECUT_E2E__);

  await page.getByRole('button', { name: 'Start Recording' }).click();
  await expect(page.getByRole('button', { name: 'Stop Sharing' })).toBeVisible({ timeout: 15000 });
  const vp = page.viewportSize() || { width: 1280, height: 720 };
  await page.waitForTimeout(700);
  for (const [fx, fy, wait] of [[0.3, 0.4, 1500], [0.7, 0.6, 1500]] as const) {
    await page.mouse.move(vp.width * fx, vp.height * fy);
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(wait);
  }
  await page.getByRole('button', { name: 'Stop Sharing' }).click();
  await page.waitForFunction(() => (window as any).__FRAMECUT_E2E__?.getSnapshot?.().hasMainVideo, null, { timeout: 20000 });

  // Recorder must not have asked for cursor:'never' (scope: no synthetic cursor dependency).
  const cons = await page.evaluate(() => JSON.stringify((window as any).__lastDisplayMediaConstraints || {}));
  expect(cons).not.toMatch(/never/);

  let s = await snap(page);
  const clicks = s.recordingEvents.filter((e: any) => e.type === 'click');
  expect(clicks.length).toBeGreaterThanOrEqual(2);
  // Remove auto zooms so the ripple maps 1:1 (zoom mapping is covered by unit tests).
  await page.evaluate(() => (window as any).__FRAMECUT_E2E__.removeAutoZooms());
  await expect.poll(async () => (await snap(page)).zoomEffects.length).toBe(0);
  s = await snap(page);
  const main = s.clips.find((c: any) => c.mediaType === 'main');
  const toTimeline = (src: number) => main.offset + (src - main.sourceStart) / (main.speed || 1);

  for (const c of clicks.slice(0, 2)) {
    const t = toTimeline(c.time);
    const far: [number, number] = [c.x > 50 ? 10 : 90, c.y > 50 ? 10 : 90];
    const [during, farDuring] = await sampleAtSourcePct(page, t + 0.1, [[c.x, c.y], far]);
    const [after] = await sampleAtSourcePct(page, t + 1.2, [[c.x, c.y]]);
    expect(tint(during)).toBeGreaterThan(tint(after) + 25); // ripple visible at click point
    expect(Math.abs(tint(farDuring) - tint(after))).toBeLessThan(10); // not elsewhere
  }

  // Auto Spotlight from the recorded clicks (clicks 1.5s apart → separate regions, auto: true; the Stop click may add one more).
  await page.getByRole('button', { name: 'Generate Auto Spotlight' }).click();
  await expect.poll(async () => (await snap(page)).spotlightEffects.filter((x: any) => x.auto).length).toBeGreaterThanOrEqual(2);
  const autos = (await snap(page)).spotlightEffects.filter((x: any) => x.auto);
  for (const c of clicks.slice(0, 2)) {
    // Each of the two deliberate clicks gets a spotlight centred on it, active at its timeline time.
    const t = toTimeline(c.time);
    expect(autos.some((a: any) => Math.abs(a.x + a.width / 2 - c.x) < 2 && Math.abs(a.y + a.height / 2 - c.y) < 2 && a.start <= t && a.end >= t)).toBe(true);
  }

  // Toggle ripples off → no tint at the first click.
  await page.getByRole('button', { name: 'Toggle Click Ripples' }).click();
  await expect.poll(async () => (await snap(page)).clickRipplesEnabled).toBe(false);
  const c0 = clicks[0];
  // Auto spotlight dims outside but the click point is its centre; compare with ripples off vs on.
  const [off] = await sampleAtSourcePct(page, toTimeline(c0.time) + 0.1, [[c0.x, c0.y]]);
  await page.getByRole('button', { name: 'Toggle Click Ripples' }).click();
  const [on] = await sampleAtSourcePct(page, toTimeline(c0.time) + 0.1, [[c0.x, c0.y]]);
  expect(tint(on)).toBeGreaterThan(tint(off) + 25);
});
