import { test, expect, Page } from '@playwright/test';

// #28: capture preflight (utils/capturePreflight.ts) warms the pipeline after mic permission,
// before Record, and never delays, blocks or persists anything.

async function boot(page: Page, init?: () => void) {
  await page.addInitScript(() => {
    (window as any).__FRAMECUT_E2E_ENABLED__ = true;
    try { localStorage.removeItem('framecut-project-v1'); } catch {}
    // Count recorders constructed (and when).
    const MR = window.MediaRecorder;
    (window as any).__recorders = [];
    (window as any).MediaRecorder = class extends MR { constructor(s: MediaStream, o?: any) { super(s, o); (window as any).__recorders.push({ at: performance.now(), video: s.getVideoTracks().length > 0 }); } };
    (window as any).MediaRecorder.isTypeSupported = MR.isTypeSupported.bind(MR);
  });
  if (init) await page.addInitScript(init);
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__FRAMECUT_E2E__);
}
const pickMic = async (page: Page) => {
  const mic = page.getByRole('combobox', { name: 'Microphone' });
  await mic.selectOption(await mic.locator('option').nth(1).getAttribute('value') as string);
  await expect(page.getByRole('meter', { name: 'Microphone level' })).toBeVisible();
};
const preflight = (page: Page) => page.evaluate(() => (window as any).__FRAMECUT_PREFLIGHT__);
const record = async (page: Page) => {
  await page.getByRole('button', { name: 'Start Recording' }).click();
  await expect(page.getByRole('button', { name: 'Stop Sharing' })).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Stop Sharing' }).click();
  await page.waitForFunction(() => (window as any).__FRAMECUT_LAST_CAPTURE__?.micBlob, null, { timeout: 15000 });
};

test('preflight runs after mic permission and adds no recorder or wait after Record', async ({ page }) => {
  await boot(page);
  await pickMic(page);
  await page.waitForFunction(() => (window as any).__FRAMECUT_PREFLIGHT__?.state === 'done', null, { timeout: 10000 });
  expect((await page.evaluate(() => (window as any).__recorders)).some((r: any) => r.video)).toBe(true); // the throwaway pair ran
  const before = await page.evaluate(() => (window as any).__recorders.length);
  const t0 = await page.evaluate(() => performance.now());
  await page.getByRole('button', { name: 'Start Recording' }).click();
  await expect(page.getByRole('button', { name: 'Stop Sharing' })).toBeVisible({ timeout: 10000 });
  const after = await page.evaluate(() => (window as any).__recorders);
  // Exactly the session's recorders (screen + narration), no warm-up recorder after Record.
  expect(after.length - before).toBe(2);
  // …and they were constructed promptly (no warm-up wait between Record and start).
  expect(Math.max(...after.slice(before).map((r: any) => r.at)) - t0).toBeLessThan(1000);
  await page.getByRole('button', { name: 'Stop Sharing' }).click();
});

test('changing the mic during preflight cancels it and releases every track it opened', async ({ page }) => {
  await boot(page);
  await pickMic(page);
  await page.waitForFunction(() => (window as any).__FRAMECUT_PREFLIGHT__?.state === 'running');
  await page.getByRole('combobox', { name: 'Microphone' }).selectOption({ index: 0 }); // Off
  await page.waitForFunction(() => (window as any).__FRAMECUT_PREFLIGHT__?.state === 'cancelled');
  await page.waitForTimeout(300);
  const states = await page.evaluate(() => (window as any).__FRAMECUT_PREFLIGHT__.tracks.map((t: MediaStreamTrack) => t.readyState));
  expect(states.length).toBeGreaterThan(0);
  expect(states.every((s: string) => s === 'ended')).toBe(true);
});

test('a failed preflight is logged and recording still works with narration', async ({ page }) => {
  const warns: string[] = [];
  page.on('console', m => { if (m.type() === 'warning') warns.push(m.text()); });
  await boot(page, () => { HTMLCanvasElement.prototype.captureStream = () => { throw new Error('no captureStream'); }; });
  await pickMic(page);
  await page.waitForFunction(() => (window as any).__FRAMECUT_PREFLIGHT__?.state === 'failed', null, { timeout: 10000 });
  expect(warns.some(w => w.includes('Capture preflight failed'))).toBe(true);
  await record(page);
  const cap = await page.evaluate(() => ({ mic: (window as any).__FRAMECUT_LAST_CAPTURE__.micBlob.size, screen: (window as any).__FRAMECUT_LAST_CAPTURE__.screenBlob.size }));
  expect(cap.mic).toBeGreaterThan(0);
  expect(cap.screen).toBeGreaterThan(0);
});

test('preflight persists nothing: no stored assets, no project, no undo step', async ({ page }) => {
  await boot(page);
  await pickMic(page);
  await page.waitForFunction(() => (window as any).__FRAMECUT_PREFLIGHT__?.state === 'done', null, { timeout: 10000 });
  await page.waitForTimeout(500);
  const r = await page.evaluate(async () => {
    const count = await new Promise<number>((res) => {
      const req = indexedDB.open('FrameCutDB');
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('assets')) { db.close(); res(0); return; }
        const c = db.transaction('assets').objectStore('assets').count();
        c.onsuccess = () => { db.close(); res(c.result); };
        c.onerror = () => { db.close(); res(-1); };
      };
      req.onerror = () => res(-1);
    });
    const s = (window as any).__FRAMECUT_E2E__.getSnapshot();
    return { count, project: localStorage.getItem('framecut-project-v1'), hasMainVideo: s.hasMainVideo, narration: !!s.narration };
  });
  expect(r.count).toBe(0);
  expect(r.project).toBeNull();
  expect(r.hasMainVideo).toBe(false);
  expect(r.narration).toBe(false);
  // No undo step: undoing changes nothing.
  const snap = () => page.evaluate(() => JSON.stringify((window as any).__FRAMECUT_E2E__.getSnapshot()));
  const s0 = await snap();
  await page.evaluate(() => (window as any).__FRAMECUT_E2E__.undo());
  await page.waitForTimeout(200);
  expect(await snap()).toBe(s0);
});
