import { Page } from '@playwright/test';
import fs from 'fs';

export async function loadFixture(page: Page, fixture: string, duration: number) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => {
    (window as any).__FRAMECUT_E2E_ENABLED__ = true;
    try { localStorage.removeItem('framecut-project-v1'); } catch {}
    (window as any).__alerts = [];
    window.alert = (m: any) => { (window as any).__alerts.push(String(m)); };
  });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__FRAMECUT_E2E__);
  const b64 = fs.readFileSync(fixture).toString('base64');
  await page.evaluate(async ([b64, duration]) => {
    const bin = atob(b64 as string); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    await (window as any).__FRAMECUT_E2E__.loadWithEvents(new Blob([u], { type: 'video/webm' }), [], duration);
  }, [b64, duration] as const);
  await page.waitForFunction(() => (window as any).__FRAMECUT_E2E__.getSnapshot().hasMainVideo);
}

export const alerts = (page: Page) => page.evaluate(() => (window as any).__alerts as string[]);

export async function openGifSettings(page: Page) {
  await page.getByRole('button', { name: /^Export/ }).first().click();
  await page.getByTestId('export-menu-gif').click();
}

/** Rewrite constants in a served module (dev server) for this page only. */
export async function patchModule(page: Page, glob: string, replacements: Array<[RegExp, string]>) {
  await page.route(glob, async route => {
    const res = await route.fetch();
    let body = await res.text();
    for (const [re, to] of replacements) body = body.replace(re, to);
    await route.fulfill({ response: res, body });
  });
}

/** Decode a GIF in the page with WebCodecs ImageDecoder. */
export const decodeGif = (page: Page, bytes: Buffer) => page.evaluate(async (b64) => {
  const bin = atob(b64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const dec = new (window as any).ImageDecoder({ data: u, type: 'image/gif' });
  await dec.tracks.ready;
  const count = dec.tracks.selectedTrack.frameCount;
  const hashes: number[] = [];
  let w = 0, h = 0;
  const c = document.createElement('canvas');
  for (let i = 0; i < count; i++) {
    const { image } = await dec.decode({ frameIndex: i });
    w = image.displayWidth; h = image.displayHeight;
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(image, 0, 0); image.close();
    const d = ctx.getImageData(0, 0, w, h).data;
    let hash = 0;
    for (let k = 0; k < d.length; k += 1) hash = (hash * 31 + d[k]) | 0;
    hashes.push(hash);
  }
  return { count, w, h, hashes };
}, bytes.toString('base64'));
