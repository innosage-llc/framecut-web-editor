/**
 * #26 P1 evidence (QA follow-up): uses a real visible test pattern (tests/fixtures/e2e-testsrc-10s.webm,
 * ffmpeg testsrc2 640x360 VP8) so pixels can be checked in headless Chromium.
 * Covers: brush/path blur stroke lands inside getFrameContentRect, spotlight handle resize,
 * subtitle rotate/scale, and export-frame pixel parity with the padded rect.
 */
import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'e2e-testsrc-10s.webm');
const E2E = (page: Page) => page.evaluate(() => (window as any).__FRAMECUT_E2E__.getSnapshot());

async function setup(page: Page) {
  await page.addInitScript(() => {
    (window as any).__FRAMECUT_E2E_ENABLED__ = true;
    try { localStorage.removeItem('framecut-project-v1'); } catch {}
  });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__FRAMECUT_E2E__);
  const b64 = fs.readFileSync(FIXTURE).toString('base64');
  await page.evaluate(async (b64) => {
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    await (window as any).__FRAMECUT_E2E__.loadWithEvents(new Blob([bytes], { type: 'video/webm' }), [], 10);
  }, b64);
  await page.waitForFunction(() => { const s = (window as any).__FRAMECUT_E2E__.getSnapshot(); return s.hasMainVideo && s.duration > 0; }, null, { timeout: 20000 });
  await page.evaluate(() => (window as any).__FRAMECUT_E2E__.seek(1));
  // Wait until an export-mode frame shows the (non-black) test pattern. Note: in headless Chromium the
  // on-screen preview canvas stays black for video content (also on main 305e2a0), so pixel checks use
  // the export renderer, which is exactly what ends up in the exported file.
  await expect.poll(async () => {
    const r = await page.evaluate(() => (window as any).__FRAMECUT_E2E__.sampleExportFrame(1, [[50, 50]]));
    return r ? r.pixels[0][0] + r.pixels[0][1] + r.pixels[0][2] : 0;
  }, { timeout: 20000 }).toBeGreaterThan(60);
}

const layerBox = async (page: Page) => (await page.getByTestId('effect-overlay-layer').boundingBox())!;

/** Expected padded content rect in page px from the real util. */
async function expectedRect(page: Page) {
  return page.evaluate(async () => {
    const m = await import('/utils/backgroundFrame.ts');
    const canvas = document.querySelector('canvas.w-full') as HTMLCanvasElement;
    const b = canvas.parentElement!.getBoundingClientRect();
    const frame = (window as any).__FRAMECUT_E2E__.getSnapshot().backgroundFrame;
    const r = m.getFrameContentRect(b.width, b.height, frame);
    return { active: m.isFrameActive(frame), x: b.left + r.x, y: b.top + r.y, width: r.width, height: r.height };
  });
}

/** Sample export-frame RGBA at points given in % of the padded CONTENT rect (W×H export canvas). */
async function exportContentPixels(page: Page, t: number, contentPts: [number, number][], W = 640, H = 360) {
  return page.evaluate(async ([t, contentPts, W, H]: any) => {
    const m = await import('/utils/backgroundFrame.ts');
    const e2e = (window as any).__FRAMECUT_E2E__;
    const f = e2e.getSnapshot().backgroundFrame;
    const r = m.isFrameActive(f) ? m.getFrameContentRect(W, H, f) : { x: 0, y: 0, width: W, height: H };
    const pts = contentPts.map(([x, y]: number[]) => [((r.x + x / 100 * r.width) / W) * 100, ((r.y + y / 100 * r.height) / H) * 100]);
    return (await e2e.sampleExportFrame(t, pts, W, H)).pixels as number[][];
  }, [t, contentPts, W, H]);
}

const diff = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

test.describe('#26 P1 evidence with a visible test video', () => {
  test.beforeEach(async ({ page }) => { await setup(page); });

  test('padded layer matches getFrameContentRect and wallpaper is outside it', async ({ page }) => {
    const exp = await expectedRect(page);
    expect(exp.active).toBe(true);
    await page.getByTitle('Add Spotlight Effect').click();
    const l = await layerBox(page);
    for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(l[k] - exp[k])).toBeLessThan(2);
  });

  test('brush/path blur stroke lands under the pointer inside the padded rect', async ({ page }) => {
    await page.getByTitle('Add Blur Effect').click();
    await page.getByRole('button', { name: 'Brush' }).click();
    await expect.poll(async () => (await E2E(page)).mosaicEffects[0]?.mode).toBe('path');
    const l = await layerBox(page);
    const y = l.y + l.height * 0.5;
    const x0 = l.x + l.width * 0.3, x1 = l.x + l.width * 0.5;
    const PTS: [number, number][] = [[40, 50], [85, 15]]; // stroke midpoint, far corner (content %)
    const [midBefore, farBefore] = await exportContentPixels(page, 1, PTS);
    await page.mouse.move(x0, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(x0 + (x1 - x0) * i / 10, y);
    await page.mouse.up();
    const m = (await E2E(page)).mosaicEffects[0];
    expect(m.paths).toHaveLength(1);
    const pts = m.paths[0].points;
    expect(pts.length).toBeGreaterThan(3);
    // Points are in % of the padded content rect, so they match the pointer % in the layer.
    expect(Math.abs(pts[0].x - 30)).toBeLessThan(1.5);
    expect(Math.abs(pts[pts.length - 1].x - 50)).toBeLessThan(1.5);
    for (const p of pts) expect(Math.abs(p.y - 50)).toBeLessThan(1.5);
    // Rendered pixels: blurred under the stroke, untouched far away.
    const [midAfter, farAfter] = await exportContentPixels(page, 1, PTS);
    expect(diff(midBefore, midAfter)).toBeGreaterThan(20);
    expect(diff(farBefore, farAfter)).toBeLessThan(20);
  });

  test('spotlight corner-handle resize maps through the padded rect', async ({ page }) => {
    await page.getByTitle('Add Spotlight Effect').click();
    const box = page.locator('[data-testid="effect-overlay-layer"] .border-amber-400').first();
    await expect(box).toBeVisible();
    const l = await layerBox(page);
    const before = (await E2E(page)).spotlightEffects[0];
    const b = (await box.boundingBox())!;
    const hx = b.x + b.width, hy = b.y + b.height; // bottom-right handle
    await page.mouse.move(hx, hy); await page.mouse.down();
    await page.mouse.move(hx + l.width * 0.05, hy + l.height * 0.05, { steps: 5 });
    await page.mouse.up();
    const after = (await E2E(page)).spotlightEffects[0];
    expect(Math.abs((after.width - before.width) - 5)).toBeLessThan(1);
    expect(Math.abs((after.height - before.height) - 5)).toBeLessThan(1);
    expect(Math.abs(after.x - before.x)).toBeLessThan(0.5);
    const nb = (await box.boundingBox())!;
    expect(Math.abs(nb.x - (l.x + after.x / 100 * l.width))).toBeLessThan(3);
    expect(Math.abs(nb.width - after.width / 100 * l.width)).toBeLessThan(3);
  });

  test('subtitle overlay is centred in padded rect; rotate and scale handles work', async ({ page }) => {
    await page.getByTitle('Add Subtitle').click();
    const ov = page.locator('[data-testid="effect-overlay-layer"] .ring-purple-500').first();
    await expect(ov).toBeVisible();
    const l = await layerBox(page);
    const s0 = (await E2E(page)).subtitleTransforms[0];
    const ob = (await ov.boundingBox())!;
    expect(Math.abs(ob.x + ob.width / 2 - (l.x + (s0.x ?? 50) / 100 * l.width))).toBeLessThan(4);
    expect(Math.abs(ob.y + ob.height / 2 - (l.y + (s0.y ?? 80) / 100 * l.height))).toBeLessThan(4);

    const rot = ov.locator('.bg-purple-500').first();
    const rb = (await rot.boundingBox())!;
    const cx = ob.x + ob.width / 2, cy = ob.y + ob.height / 2;
    await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2); await page.mouse.down();
    await page.mouse.move(cx + 80, cy, { steps: 8 }); await page.mouse.up();
    const s1 = (await E2E(page)).subtitleTransforms[0];
    expect(Math.abs(s1.rotation ?? 0)).toBeGreaterThan(30);

    const sc = ov.locator('.cursor-nwse-resize').first();
    const sb = (await sc.boundingBox())!;
    await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2); await page.mouse.down();
    await page.mouse.move(sb.x + 60, sb.y + 60, { steps: 6 }); await page.mouse.up();
    const s2 = (await E2E(page)).subtitleTransforms[0];
    expect(s2.scale ?? 1).toBeGreaterThan(1.1);
  });

  test('export frame: spotlight lit inside / dimmed outside at padded-rect positions; wallpaper outside content', async ({ page }) => {
    const PTS: [number, number][] = [[50, 50], [10, 10]]; // spotlight centre (default 40/40/20/20), outside
    await page.getByTitle('Add Spotlight Effect').click();
    const s = (await E2E(page)).spotlightEffects[0];
    const t = (s.start + s.end) / 2;
    const before = await exportContentPixels(page, Math.max(0, s.start - 0.5) >= 0 && s.start > 0.6 ? s.start - 0.5 : s.end + 0.5, PTS);
    const during = await exportContentPixels(page, t, PTS);
    const lum = (p: number[]) => p[0] + p[1] + p[2];
    expect(lum(during[1])).toBeLessThan(lum(before[1]) * 0.5 + 10); // outside dimmed
    expect(lum(during[0])).toBeGreaterThan(60);                       // centre still shows video
    // Corner of export canvas is wallpaper, i.e. content is inset by the padding.
    const corner = await page.evaluate(() => (window as any).__FRAMECUT_E2E__.sampleExportFrame(1, [[0.5, 0.5]]));
    const inner = await exportContentPixels(page, 1, [[0.5, 0.5]]);
    expect(diff(corner.pixels[0], inner[0])).toBeGreaterThan(10);
  });

  for (const c of [
    { name: 'frame ON, padding 0.25 (UI max)', patch: { enabled: true, padding: 0.25 } },
    { name: 'frame ON, padding 0.40 requested (clamped to 0.25 by getFrameContentRect)', patch: { enabled: true, padding: 0.4 } },
    { name: 'frame OFF', patch: { enabled: false } },
  ]) {
    test(`brush blur stroke lands under the pointer — ${c.name}`, async ({ page }) => {
      await page.evaluate((p) => (window as any).__FRAMECUT_E2E__.setBackgroundFrame(p), c.patch);
      await expect.poll(async () => JSON.stringify((await E2E(page)).backgroundFrame)).toContain(JSON.stringify(c.patch).slice(1, -1).split(',')[0]);
      const exp = await expectedRect(page);
      expect(exp.active).toBe(c.patch.enabled);
      await page.getByTitle('Add Blur Effect').click();
      await page.getByRole('button', { name: 'Brush' }).click();
      await expect.poll(async () => (await E2E(page)).mosaicEffects[0]?.mode).toBe('path');
      const l = await layerBox(page);
      if (c.patch.enabled) {
        for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(l[k] - exp[k])).toBeLessThan(2);
      } else {
        const content = (await page.locator('canvas.w-full').boundingBox())!;
        for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(l[k] - content[k])).toBeLessThan(2);
      }
      const PTS: [number, number][] = [[60, 35], [10, 85]];
      const [midBefore, farBefore] = await exportContentPixels(page, 1, PTS);
      const y = l.y + l.height * 0.35, x0 = l.x + l.width * 0.5, x1 = l.x + l.width * 0.7;
      await page.mouse.move(x0, y); await page.mouse.down();
      for (let i = 1; i <= 10; i++) await page.mouse.move(x0 + (x1 - x0) * i / 10, y);
      await page.mouse.up();
      const paths = (await E2E(page)).mosaicEffects[0].paths;
      expect(paths).toHaveLength(1);
      const pts = paths[0].points;
      expect(pts.length).toBeGreaterThan(3);
      expect(Math.abs(pts[0].x - 50)).toBeLessThan(1.5);
      expect(Math.abs(pts[pts.length - 1].x - 70)).toBeLessThan(1.5);
      for (const p of pts) expect(Math.abs(p.y - 35)).toBeLessThan(1.5);
      const [midAfter, farAfter] = await exportContentPixels(page, 1, PTS);
      expect(diff(midBefore, midAfter)).toBeGreaterThan(20);
      expect(diff(farBefore, farAfter)).toBeLessThan(20);
    });
  }
});
