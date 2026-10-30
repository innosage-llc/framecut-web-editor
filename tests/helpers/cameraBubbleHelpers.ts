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

export async function loadWithCamera(page: Page, timeOffset: number, cameraDuration = 6, screenPath = SCREEN, cameraPath = CAMERA) {
  const s = fs.readFileSync(screenPath).toString('base64');
  const c = fs.readFileSync(cameraPath).toString('base64');
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

export const SCREEN_FI = 'tests/fixtures/e2e-screen-frameindex-10s.webm';
export const CAMERA_FI = 'tests/fixtures/e2e-camera-frameindex-10s.webm';

/** Split at 4 s, speed the left half to 2x, trim 1 s off the right half's head. */
export async function applyLinkedEdits(page: Page) {
  let s = await E2E(page);
  const id = s.cameraBubbles[0].id;
  await callApi(page, 'select', { type: 'clip', id });
  await callApi(page, 'seek', 4);
  await callApi(page, 'split');
  s = await E2E(page);
  const left = s.cameraBubbles.find((c: any) => c.sourceStart === 0);
  await callApi(page, 'select', { type: 'clip', id: left.id });
  await callApi(page, 'setSelectedSpeed', 2);
  s = await E2E(page);
  const right = s.cameraBubbles.find((c: any) => c.sourceStart > 0);
  await callApi(page, 'updateClip', right.id, { sourceStart: right.sourceStart + 1 });
  return (await E2E(page)).cameraBubbles;
}

/** Replaces AudioEncoder with a no-op: Linux Chromium/Chrome have no AAC encoder, so MP4 is video-only. */
export const noAacShim = () => {
  (window as any).AudioEncoder = class {
    state = 'unconfigured';
    constructor(_init: any) {}
    configure() { this.state = 'configured'; }
    encode(d: any) { d?.close?.(); }
    async flush() {}
    close() { this.state = 'closed'; }
  };
};

export async function exportGif(page: Page) {
  await page.getByRole('button', { name: /^Export/ }).first().click();
  await page.getByTestId('export-menu-gif').click();
  await page.getByLabel('GIF frame rate').selectOption('10');
  await page.getByLabel('GIF max longest side').selectOption('480');
  const gdl = page.waitForEvent('download', { timeout: 280_000 });
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Export GIF' }).click();
  const path = (await (await gdl).path())!;
  return { path, seconds: (Date.now() - t0) / 1000 };
}

export async function exportMp4(page: Page) {
  await page.getByRole('button', { name: /^Export/ }).first().click();
  await page.getByRole('button', { name: /MP4/ }).first().click();
  const settings = page.getByRole('button', { name: 'Export MP4' });
  const dl = page.waitForEvent('download', { timeout: 280_000 });
  let t0 = Date.now();
  if (await settings.isVisible().catch(() => false)) { t0 = Date.now(); await settings.click(); }
  const path = (await (await dl).path())!;
  return { path, seconds: (Date.now() - t0) / 1000 };
}

/** Decode every GIF frame in the page; returns per-frame RGBA as base64. */
export const decodeGifFrames = (page: Page, bytes: Buffer) => page.evaluate(async (b64) => {
  const bin = atob(b64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const dec = new (window as any).ImageDecoder({ data: u, type: 'image/gif' });
  await dec.tracks.ready;
  const count = dec.tracks.selectedTrack.frameCount;
  const c = document.createElement('canvas');
  const frames: string[] = [];
  for (let i = 0; i < count; i++) {
    const { image } = await dec.decode({ frameIndex: i });
    c.width = image.displayWidth; c.height = image.displayHeight;
    const ctx = c.getContext('2d')!; ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(image, 0, 0); image.close();
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let s = ''; for (let k = 0; k < d.length; k += 0x8000) s += String.fromCharCode(...d.subarray(k, k + 0x8000));
    frames.push(btoa(s));
  }
  return { count, w: c.width, h: c.height, frames };
}, bytes.toString('base64'));
