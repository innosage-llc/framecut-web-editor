import { test, expect } from '@playwright/test';
import fs from 'fs';
test('saved narrated project reloads without requesting dead blob URLs (QA #49 W2)', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__FRAMECUT_E2E_ENABLED__ = true;
    if (!sessionStorage.getItem('booted')) { sessionStorage.setItem('booted', '1'); try { localStorage.removeItem('framecut-project-v1'); } catch {} }
  });
  const errs: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text() + ' @ ' + JSON.stringify(m.location())); });
  page.on('requestfailed', r => errs.push('FAILED ' + r.url()));
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__FRAMECUT_E2E__);
  const b64 = fs.readFileSync('tests/fixtures/e2e-testsrc-10s.webm').toString('base64');
  await page.evaluate(async (b64) => {
    const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const ctx = new OfflineAudioContext(1, 48000 * 2, 48000); const buf = await ctx.startRendering();
    const wav = (() => { const n = buf.length; const ab = new ArrayBuffer(44 + n * 2); const v = new DataView(ab); const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      w(0,'RIFF'); v.setUint32(4,36+n*2,true); w(8,'WAVE'); w(12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true); v.setUint32(24,48000,true); v.setUint32(28,96000,true); v.setUint16(32,2,true); v.setUint16(34,16,true); w(36,'data'); v.setUint32(40,n*2,true); return ab; })();
    await (window as any).__FRAMECUT_E2E__.loadWithNarration(new Blob([u], { type: 'video/webm' }), [], 10, new Blob([wav], { type: 'audio/wav' }), 0.2, 2);
  }, b64);
  await page.waitForFunction(() => (window as any).__FRAMECUT_E2E__.getSnapshot().narrationClips.length > 0);
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /save/i }).first().click();
  await page.waitForTimeout(2000);
  errs.push('--- reload ---');
  await page.reload();
  await page.waitForTimeout(4000);
  const after = errs.slice(errs.indexOf('--- reload ---'));
  expect(after.filter(e => e.includes('ERR_FILE_NOT_FOUND'))).toEqual([]);
  await page.waitForFunction(() => { const s = (window as any).__FRAMECUT_E2E__?.getSnapshot(); return s?.hasMainVideo && s.narrationClips.length > 0; }, null, { timeout: 15000 });
  // The media came back from IndexedDB under fresh URLs.
  const srcs = await page.evaluate(() => [...document.querySelectorAll('video, audio')].map(e => (e as HTMLMediaElement).currentSrc).filter(Boolean));
  expect(srcs.length).toBeGreaterThan(0);
});

test('saved camera project reloads without requesting dead blob URLs (QA #49 W2)', async ({ page }) => {
  const { loadWithCamera } = await import('./helpers/cameraBubbleHelpers');
  await page.addInitScript(() => {
    (window as any).__FRAMECUT_E2E_ENABLED__ = true;
    if (!sessionStorage.getItem('booted')) { sessionStorage.setItem('booted', '1'); try { localStorage.removeItem('framecut-project-v1'); } catch {} }
  });
  const errs: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__FRAMECUT_E2E__);
  await loadWithCamera(page, 0.5, 6);
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /save/i }).first().click();
  await page.waitForTimeout(2000);
  errs.length = 0;
  await page.reload();
  await page.waitForFunction(() => { const s = (window as any).__FRAMECUT_E2E__?.getSnapshot(); return s?.hasMainVideo && !!s.camera; }, null, { timeout: 15000 });
  await page.waitForFunction(() => { const v = document.querySelector('[data-testid="camera-video"]') as HTMLVideoElement | null; return !!v && v.readyState >= 1; }, null, { timeout: 15000 });
  await page.waitForTimeout(1000);
  expect(errs.filter(e => e.includes('ERR_FILE_NOT_FOUND'))).toEqual([]);
});

// ---- assets missing from IndexedDB, and a legacy `mirrored` bubble field ----

async function bootPersisting(page: any, errs: string[]) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => {
    (window as any).__FRAMECUT_E2E_ENABLED__ = true;
    if (!sessionStorage.getItem('booted')) { sessionStorage.setItem('booted', '1'); try { localStorage.removeItem('framecut-project-v1'); } catch {} }
  });
  page.on('console', (m: any) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__FRAMECUT_E2E__);
}

async function save(page: any) {
  await page.getByRole('button', { name: /save/i }).first().click();
  await page.waitForFunction(() => !!localStorage.getItem('framecut-project-v1'));
  await page.waitForTimeout(1500);
}

/** Delete the saved asset `key` (e.g. 'narration', 'camera') from IndexedDB, as if it was evicted. */
const dropFromDB = (page: any, key: string) => page.evaluate(async (key: string) => {
  const id = JSON.parse(localStorage.getItem('framecut-project-v1')!)[key]?.storageId;
  if (!id) throw new Error('no storageId for ' + key);
  const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('FrameCutDB'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  await new Promise<void>((res, rej) => { const tx = db.transaction('assets', 'readwrite'); tx.objectStore('assets').delete(id); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  db.close();
}, key);

for (const key of ['narration', 'camera'] as const) {
  test(`a saved ${key} missing from IndexedDB reloads without requesting its dead blob URL`, async ({ page }) => {
    const errs: string[] = [];
    await bootPersisting(page, errs);
    if (key === 'camera') {
      const { loadWithCamera } = await import('./helpers/cameraBubbleHelpers');
      await loadWithCamera(page, 0.5, 6);
    } else {
      const b64 = fs.readFileSync('tests/fixtures/e2e-testsrc-10s.webm').toString('base64');
      await page.evaluate(async (b64: string) => {
        const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const n = 48000; const ab = new ArrayBuffer(44 + n * 2); const v = new DataView(ab); const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
        w(0,'RIFF'); v.setUint32(4,36+n*2,true); w(8,'WAVE'); w(12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true); v.setUint32(24,48000,true); v.setUint32(28,96000,true); v.setUint16(32,2,true); v.setUint16(34,16,true); w(36,'data'); v.setUint32(40,n*2,true);
        await (window as any).__FRAMECUT_E2E__.loadWithNarration(new Blob([u], { type: 'video/webm' }), [], 10, new Blob([ab], { type: 'audio/wav' }), 0.2, 1);
      }, b64);
      await page.waitForFunction(() => (window as any).__FRAMECUT_E2E__.getSnapshot().narrationClips.length > 0);
    }
    await page.waitForTimeout(800);
    await save(page);
    await dropFromDB(page, key);
    errs.length = 0;
    await page.reload();
    await page.waitForFunction(() => (window as any).__FRAMECUT_E2E__?.getSnapshot()?.hasMainVideo, null, { timeout: 15000 });
    await page.waitForTimeout(2000);
    expect(errs.filter(e => e.includes('ERR_FILE_NOT_FOUND'))).toEqual([]);
    // Nothing on the page points at a blob URL that no longer exists.
    const live = await page.evaluate(() => [...document.querySelectorAll('video, audio')].map(e => (e as HTMLMediaElement).getAttribute('src')).filter(s => s && s.startsWith('blob:')));
    for (const src of live) expect(await page.evaluate(async (u: string) => { try { await (await fetch(u)).blob(); return true; } catch { return false; } }, src)).toBe(true);
  });
}

test('a saved bubble with a legacy mirrored flag loads and renders unmirrored', async ({ page }) => {
  const errs: string[] = [];
  const { loadWithCamera, sample, SCREEN_FI, CAMERA_FI } = await import('./helpers/cameraBubbleHelpers');
  await bootPersisting(page, errs);
  await loadWithCamera(page, 0, 10, SCREEN_FI, CAMERA_FI);
  await page.waitForTimeout(800);
  // Frame-index camera at t=1 (frame 30 = 0b000011110): top-left cell black, top-right cell white.
  // Their centres in the default bubble on 640x360 (x 496.8 / 532.8, y 270 px) mirror each other; sample() takes %.
  const pts: [number, number][] = [[496.8 / 6.4, 270 / 3.6], [532.8 / 6.4, 270 / 3.6]];
  const before = await sample(page, 1, pts);
  await save(page);
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('framecut-project-v1')!);
    for (const c of p.clips) if (c.cameraBubble) c.cameraBubble.mirrored = true;
    localStorage.setItem('framecut-project-v1', JSON.stringify(p));
  });
  await page.reload();
  await page.waitForFunction(() => { const s = (window as any).__FRAMECUT_E2E__?.getSnapshot(); return s?.hasMainVideo && !!s.camera; }, null, { timeout: 15000 });
  await page.waitForFunction(() => { const v = document.querySelector('[data-testid="camera-video"]') as HTMLVideoElement | null; return !!v && v.readyState >= 2; }, null, { timeout: 15000 });
  const after = await sample(page, 1, pts);
  for (let i = 0; i < pts.length; i++) for (let c = 0; c < 3; c++) expect(Math.abs(after[i][c] - before[i][c])).toBeLessThanOrEqual(12);
  // Unmirrored orientation: frame 30 has bit 0 (top-left cell) off and bit 2 (top-right cell) on.
  // A mirrored draw would swap them, before or after the reload.
  const lum = (px: number[]) => (px[0] + px[1] + px[2]) / 3;
  for (const px of [before, after]) { expect(lum(px[0])).toBeLessThan(64); expect(lum(px[1])).toBeGreaterThan(192); }
  await expect(page.getByLabel('Mirror camera')).toHaveCount(0);
});
