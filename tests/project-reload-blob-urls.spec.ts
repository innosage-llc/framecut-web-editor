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
