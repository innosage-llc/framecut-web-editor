import { test, expect, Page } from '@playwright/test';
import fs from 'fs';

// #28 QA (PR-B sync WARN): narration vs screen audio alignment over repeated sessions.
// Chromium's fake mic and fake display audio emit beeps from the same generator clock, so a beep's
// onset in the narration (placed at its measured timeOffset) must match the same beep in the
// screen recording's own audio track.

const SESSIONS = Number(process.env.SYNC_SESSIONS || 6);
const TOL_MS = 20;

async function boot(page: Page) {
  await page.addInitScript(() => {
    (window as any).__FRAMECUT_E2E_ENABLED__ = true;
    try { localStorage.removeItem('framecut-project-v1'); } catch {}
  });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__FRAMECUT_E2E__);
}

/** Onsets (s) of beeps in a blob's first audio channel: rising edges of a 2 ms RMS envelope. */
const onsetsIn = (page: Page, which: 'micBlob' | 'screenBlob') => page.evaluate(async (which) => {
  const b = (window as any).__FRAMECUT_LAST_CAPTURE__[which] as Blob;
  const buf = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await b.arrayBuffer());
  const d = buf.getChannelData(0), sr = buf.sampleRate, win = Math.round(sr * 0.002);
  const env: number[] = [];
  for (let i = 0; i + win <= d.length; i += win) { let s = 0; for (let j = i; j < i + win; j++) s += d[j] * d[j]; env.push(Math.sqrt(s / win)); }
  const peak = Math.max(...env), thr = peak * 0.3, out: number[] = [];
  let on = false;
  for (let k = 0; k < env.length; k++) {
    if (!on && env[k] > thr) { on = true; out.push((k * win) / sr); }
    else if (on && env[k] < thr * 0.3) on = false;
  }
  return out;
}, which);

test(`narration lands within ${TOL_MS} ms of the screen audio in every one of ${SESSIONS} sessions`, async ({ page }) => {
  test.setTimeout(60_000 + SESSIONS * 20_000);
  const errs: number[] = [];
  const rows: any[] = [];
  for (let i = 0; i < SESSIONS; i++) {
    await boot(page);
    const mic = page.getByRole('combobox', { name: 'Microphone' });
    await mic.selectOption(await mic.locator('option').nth(1).getAttribute('value') as string);
    await expect(page.getByRole('meter', { name: 'Microphone level' })).toBeVisible();
    await page.getByRole('button', { name: 'Start Recording' }).click();
    await expect(page.getByRole('button', { name: 'Stop Sharing' })).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2600 + (i % 3) * 300);
    await page.getByRole('button', { name: 'Stop Sharing' }).click();
    await page.waitForFunction(() => (window as any).__FRAMECUT_LAST_CAPTURE__?.micBlob, null, { timeout: 15000 });
    const cap = await page.evaluate(() => { const c = (window as any).__FRAMECUT_LAST_CAPTURE__; return { sources: c.sources, narrationTimeOffset: c.narrationTimeOffset }; });
    const screenOn = await onsetsIn(page, 'screenBlob');
    const micOn = await onsetsIn(page, 'micBlob');
    // Each narration beep, on the screen timeline, against the nearest screen-audio beep.
    const pairs = micOn.map(m => m + cap.narrationTimeOffset).map(t => {
      const near = screenOn.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a), Infinity);
      return (t - near) * 1000;
    }).filter(e => Math.abs(e) < 250);
    // Every narration beep must pair with a screen beep (≥ 2 per second recorded); a partial match is a
    // broken capture or measurement, not a sync result, so it fails loudly instead of being averaged.
    // Only beeps that land inside the screen recording can match (one before its first beep can't).
    const inside = micOn.map(m => m + cap.narrationTimeOffset).filter(t => t >= screenOn[0] - 0.25 && t <= screenOn[screenOn.length - 1] + 0.25);
    expect(inside.length, `session ${i}: too few narration beeps (mic ${micOn})`).toBeGreaterThanOrEqual(4);
    expect(pairs.length, `session ${i}: only ${pairs.length} of ${inside.length} narration beeps matched (screen ${screenOn}, mic ${micOn})`).toBeGreaterThanOrEqual(inside.length);
    const err = pairs.reduce((a, b) => a + b, 0) / pairs.length;
    errs.push(err);
    rows.push({ session: i, errMs: +err.toFixed(1), beeps: pairs.length, narrationTimeOffset: cap.narrationTimeOffset, sources: cap.sources });
  }
  const abs = errs.map(Math.abs);
  const stats = { sessions: SESSIONS, meanMs: +(errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(1), meanAbsMs: +(abs.reduce((a, b) => a + b, 0) / abs.length).toFixed(1), maxAbsMs: +Math.max(...abs).toFixed(1) };
  console.log('MIC_SYNC', JSON.stringify(stats), JSON.stringify(rows.map(r => r.errMs)));
  if (process.env.SYNC_OUT) fs.writeFileSync(process.env.SYNC_OUT, JSON.stringify({ stats, rows }, null, 1));
  for (const r of rows) expect(Math.abs(r.errMs), `session ${r.session}`).toBeLessThanOrEqual(TOL_MS);
});
