import { Page } from '@playwright/test';
import fs from 'fs';

// #28 PR-C: camera bubble (macOS #64 defaults). Camera fixture: 320x240, 6 s, three solid colours,
// 0–2 s pink, 2–4 s cyan, 4–6 s yellow, so the camera media time can be read back from pixels.
export const PINK = [255, 0, 128], CYAN = [0, 192, 255], YELLOW = [255, 224, 0];
export const SCREEN = 'tests/fixtures/e2e-testsrc-10s.webm'; // 640x360, 10 s
export const CAMERA = 'tests/fixtures/e2e-camera-3color-6s.webm';

export const settle = (page: Page) => page.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 100))));
export const E2E = async (page: Page) => { await settle(page); return page.evaluate(() => (window as any).__FRAMECUT_E2E__.getSnapshot()); };
export const callApi = async (page: Page, fn: string, ...args: any[]) => {
  const r = await page.evaluate(([fn, args]) => (window as any).__FRAMECUT_E2E__[fn as string](...(args as any[])), [fn, args] as const);
  await settle(page);
  return r;
};
export const near = (px: number[], rgb: number[], tol = 40) => rgb.every((v, i) => Math.abs(px[i] - v) <= tol);

export async function boot(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => {
    (window as any).__FRAMECUT_E2E_ENABLED__ = true;
    try { localStorage.removeItem('framecut-project-v1'); } catch {}
    (window as any).__alerts = [];
    window.alert = (m: any) => { (window as any).__alerts.push(String(m)); };
  });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__FRAMECUT_E2E__);
}

export async function loadWithCamera(page: Page, timeOffset: number, cameraDuration = 6) {
  const s = fs.readFileSync(SCREEN).toString('base64');
  const c = fs.readFileSync(CAMERA).toString('base64');
  await page.evaluate(async ([s, c, timeOffset, cameraDuration]) => {
    const blob = (b64: string) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: 'video/webm' }); };
    await (window as any).__FRAMECUT_E2E__.loadWithCamera(blob(s as string), [], 10, blob(c as string), timeOffset, cameraDuration);
  }, [s, c, timeOffset, cameraDuration] as const);
  await page.waitForFunction(() => !!(window as any).__FRAMECUT_E2E__.getSnapshot().camera);
  await page.waitForFunction(() => { const v = document.querySelector('[data-testid="camera-video"]') as HTMLVideoElement | null; return !!v && v.readyState >= 1; });
}

/** Centre of the bubble in % of the canvas, from the same geometry the renderer uses. */
export async function bubbleCentre(page: Page, bubble: any, w = 640, h = 360) {
  return page.evaluate(async ([bubble, w, h]) => {
    // @ts-ignore in-page Vite module
    const B = await import('/utils/cameraBubble.ts');
    const r = B.bubbleRect(B.normalizeBubble(bubble), w, h);
    return [((r.x + r.width / 2) / (w as number)) * 100, ((r.y + r.height / 2) / (h as number)) * 100] as [number, number];
  }, [bubble, w, h] as const);
}

/** Render one export-mode frame (the same path as MP4/GIF/still) and sample pixels. */
export async function sample(page: Page, t: number, points: [number, number][]) {
  const r = await callApi(page, 'sampleExportFrame', t, points, 640, 360);
  return r.pixels as number[][];
}

/** Sample the visible preview canvas at % points. */
export async function previewPixel(page: Page, [x, y]: [number, number]) {
  return page.evaluate(([x, y]) => {
    const c = Array.from(document.querySelectorAll('canvas')).sort((a, b) => b.width * b.height - a.width * a.height)[0] as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    return Array.from(ctx.getImageData(Math.round(x / 100 * (c.width - 1)), Math.round(y / 100 * (c.height - 1)), 1, 1).data);
  }, [x, y] as const);
}
