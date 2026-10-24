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

test('6 recorded clicks (2 quick): ripple per click; Auto Spotlight groups the quick pair, skips a trimmed click, keeps manual; export + toggle', async ({ page }) => {
  test.setTimeout(120000);
  await mockDisplayMedia(page);
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__FRAMECUT_E2E__);
  await page.getByRole('button', { name: 'Start Recording' }).click();
  await expect(page.getByRole('button', { name: 'Stop Sharing' })).toBeVisible({ timeout: 15000 });
  const vp = page.viewportSize() || { width: 1280, height: 720 };
  await page.waitForTimeout(700);
  // [fx, fy, wait-after ms]; #1→#2 is the quick pair (~0.4s apart, < 0.8s merge gap).
  const PLAN = [[0.30, 0.25, 400], [0.34, 0.28, 1400], [0.70, 0.25, 1400], [0.45, 0.42, 1400], [0.75, 0.42, 1400], [0.55, 0.30, 1400]] as const;
  for (const [fx, fy, wait] of PLAN) {
    await page.mouse.move(vp.width * fx, vp.height * fy);
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(wait);
  }
  await page.getByRole('button', { name: 'Stop Sharing' }).click();
  await page.waitForFunction(() => (window as any).__FRAMECUT_E2E__?.getSnapshot?.().hasMainVideo, null, { timeout: 20000 });
  await page.evaluate(() => (window as any).__FRAMECUT_E2E__.removeAutoZooms());
  await expect.poll(async () => (await snap(page)).zoomEffects.length).toBe(0);

  let s = await snap(page);
  const clicks = s.recordingEvents.filter((e: any) => e.type === 'click').slice(0, 6);
  expect(clicks.length).toBe(6);
  expect(clicks[1].time - clicks[0].time).toBeLessThan(0.8);
  for (let i = 2; i < 6; i++) expect(clicks[i].time - clicks[i - 1].time).toBeGreaterThan(0.8);
  // Positions recorded as % of the viewport.
  clicks.forEach((c: any, i: number) => { expect(Math.abs(c.x - PLAN[i][0] * 100)).toBeLessThan(1); expect(Math.abs(c.y - PLAN[i][1] * 100)).toBeLessThan(1); });

  // Ripple at each click's time + position in export frames (untrimmed: timeline time == source time).
  for (const c of clicks) {
    const [during] = await sampleAtSourcePct(page, c.time + 0.1, [[c.x, c.y]]);
    const [after] = await sampleAtSourcePct(page, c.time + 1.0, [[c.x, c.y]]);
    expect(tint(during), `ripple at click t=${c.time.toFixed(2)}`).toBeGreaterThan(tint(after) + 25);
  }

  // Trim out click #4 (index 3): keep source [0, c4-0.3] and [c4+0.3, end].
  const main = s.clips.find((c: any) => c.mediaType === 'main');
  const cut = clicks[3].time;
  await page.evaluate(([a, b, end]) => (window as any).__FRAMECUT_E2E__.setMainSourceRanges([[0, a], [b, end]]), [cut - 0.3, cut + 0.3, main.sourceEnd]);
  await expect.poll(async () => (await snap(page)).clips.filter((c: any) => c.mediaType === 'main').length).toBe(2);
  s = await snap(page);
  const mains = s.clips.filter((c: any) => c.mediaType === 'main');
  const toTimeline = (src: number) => { for (const c of mains) if (src >= c.sourceStart && src <= c.sourceEnd) return c.offset + (src - c.sourceStart) / (c.speed || 1); return null; };

  // Manual spotlight first (must survive regenerate).
  await page.getByTitle('Add Spotlight Effect').click();
  await expect.poll(async () => (await snap(page)).spotlightEffects.filter((x: any) => !x.auto).length).toBe(1);
  const manualId = (await snap(page)).spotlightEffects.find((x: any) => !x.auto).id;

  const checkAutos = async () => {
    const all = (await snap(page)).spotlightEffects;
    const autos = all.filter((x: any) => x.auto);
    const centredOn = (a: any, c: any) => Math.abs(a.x + a.width / 2 - c.x) < 3 && Math.abs(a.y + a.height / 2 - c.y) < 3;
    const activeAt = (a: any, t: number) => a.start <= t && a.end >= t;
    // Quick pair → exactly ONE region covering both clicks, centred between them.
    const t0 = toTimeline(clicks[0].time)!, t1 = toTimeline(clicks[1].time)!;
    const pair = autos.filter((a: any) => activeAt(a, t0) || activeAt(a, t1));
    expect(pair.length).toBe(1);
    expect(activeAt(pair[0], t0) && activeAt(pair[0], t1)).toBe(true);
    expect(centredOn(pair[0], { x: (clicks[0].x + clicks[1].x) / 2, y: (clicks[0].y + clicks[1].y) / 2 })).toBe(true);
    // Trimmed click #4 → no region.
    expect(toTimeline(clicks[3].time)).toBeNull();
    expect(autos.some((a: any) => centredOn(a, clicks[3]))).toBe(false);
    // Clicks #3, #5, #6 → one region each, active at their timeline time.
    for (const i of [2, 4, 5]) {
      const t = toTimeline(clicks[i].time)!;
      expect(autos.filter((a: any) => centredOn(a, clicks[i]) && activeAt(a, t)).length, `click #${i + 1}`).toBe(1);
    }
    expect(all.some((x: any) => x.id === manualId && !x.auto)).toBe(true);
    return autos;
  };

  await page.getByRole('button', { name: 'Generate Auto Spotlight' }).click();
  await expect.poll(async () => (await snap(page)).spotlightEffects.filter((x: any) => x.auto).length).toBeGreaterThanOrEqual(4);
  const first = await checkAutos();
  // Regenerate: replaces autos (new ids, same count), manual survives.
  await page.getByRole('button', { name: 'Generate Auto Spotlight' }).click();
  await expect.poll(async () => (await snap(page)).spotlightEffects.filter((x: any) => x.auto).map((x: any) => x.id).join()).not.toBe(first.map((x: any) => x.id).join());
  const second = await checkAutos();
  expect(second.length).toBe(first.length);

  // Export frames after trim: ripple at click #5 (timeline-mapped); toggle off removes it.
  const c5 = clicks[4]; const t5 = toTimeline(c5.time)!;
  const [on] = await sampleAtSourcePct(page, t5 + 0.1, [[c5.x, c5.y]]);
  await page.getByRole('button', { name: 'Toggle Click Ripples' }).click();
  await expect.poll(async () => (await snap(page)).clickRipplesEnabled).toBe(false);
  const [off] = await sampleAtSourcePct(page, t5 + 0.1, [[c5.x, c5.y]]);
  expect(tint(on)).toBeGreaterThan(tint(off) + 25);
});

/** Preview canvas RGBA at source-% points mapped through the padded frame rect (CSS px of the preview canvas). */
async function previewAtSourcePct(page: Page, pts: [number, number][]) {
  return page.evaluate(async (pts) => {
    const m = await import('/utils/backgroundFrame.ts');
    const c = document.querySelector('canvas.w-full') as HTMLCanvasElement;
    const f = (window as any).__FRAMECUT_E2E__.getSnapshot().backgroundFrame;
    const r = m.isFrameActive(f) ? m.getFrameContentRect(c.width, c.height, f) : { x: 0, y: 0, width: c.width, height: c.height };
    const ctx = c.getContext('2d')!;
    return pts.map(([x, y]) => Array.from(ctx.getImageData(Math.round(r.x + x / 100 * r.width), Math.round(r.y + y / 100 * r.height), 1, 1).data));
  }, pts);
}

test('on-screen PREVIEW canvas shows a ripple at each recorded click (paused seek), and not when toggled off', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await mockDisplayMedia(page);
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__FRAMECUT_E2E__);
  await page.getByRole('button', { name: 'Start Recording' }).click();
  await expect(page.getByRole('button', { name: 'Stop Sharing' })).toBeVisible({ timeout: 15000 });
  const vp = page.viewportSize()!;
  await page.waitForTimeout(700);
  for (const [fx, fy] of [[0.35, 0.3], [0.65, 0.35], [0.5, 0.4]] as const) {
    await page.mouse.move(vp.width * fx, vp.height * fy); await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(1300);
  }
  await page.getByRole('button', { name: 'Stop Sharing' }).click();
  await page.waitForFunction(() => (window as any).__FRAMECUT_E2E__?.getSnapshot?.().hasMainVideo, null, { timeout: 20000 });
  await page.evaluate(() => (window as any).__FRAMECUT_E2E__.removeAutoZooms());
  await expect.poll(async () => (await snap(page)).zoomEffects.length).toBe(0);
  const clicks = (await snap(page)).recordingEvents.filter((e: any) => e.type === 'click').slice(0, 3);
  expect(clicks.length).toBe(3);

  const previewTintAt = async (t: number, c: any) => {
    await page.evaluate((t) => (window as any).__FRAMECUT_E2E__.seek(t), t);
    await page.waitForTimeout(400);
    return tint((await previewAtSourcePct(page, [[c.x, c.y]]))[0]);
  };
  for (const [i, c] of clicks.entries()) {
    const during = await previewTintAt(c.time + 0.1, c);
    if (i === 0 && process.env.FRAMECUT_EVIDENCE_DIR) await page.screenshot({ path: `${process.env.FRAMECUT_EVIDENCE_DIR}/pr38-preview-ripple-click1.png` });
    const after = await previewTintAt(c.time + 1.0, c);
    expect(during, `preview ripple at click ${i + 1}`).toBeGreaterThan(after + 25);
  }
  await page.getByRole('button', { name: 'Toggle Click Ripples' }).click();
  await expect.poll(async () => (await snap(page)).clickRipplesEnabled).toBe(false);
  const off = await previewTintAt(clicks[0].time + 0.1 + 0.001, clicks[0]);
  const on0 = await (async () => { await page.getByRole('button', { name: 'Toggle Click Ripples' }).click(); return previewTintAt(clicks[0].time + 0.1, clicks[0]); })();
  expect(on0).toBeGreaterThan(off + 25);
});
