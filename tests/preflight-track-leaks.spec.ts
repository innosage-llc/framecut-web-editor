import { test, expect, Page } from '@playwright/test';

// #28 (QA BLOCK on 7675aa6): every track the mic preview / capture preflight opens (getUserMedia,
// MediaStream/MediaStreamTrack clones, Web Audio destinations, canvas streams) is stopped on every
// cancel path: mic Off, mic device change, the screen picker returning (Record), pagehide, and a
// preflight error. Checked right away and again 400 ms later.

async function boot(page: Page, init?: () => void) {
  await page.addInitScript(() => {
    (window as any).__FRAMECUT_E2E_ENABLED__ = true;
    try { localStorage.removeItem('framecut-project-v1'); } catch {}
    const all: { src: string; t: MediaStreamTrack }[] = [];
    (window as any).__tracks = all;
    const tag = (src: string, ts: MediaStreamTrack[]) => ts.forEach(t => all.push({ src, t }));
    const wrapStream = (obj: any, name: string, src: string) => {
      const orig = obj[name];
      obj[name] = function (...a: any[]) {
        const r = orig.apply(this, a);
        if (r instanceof Promise) return r.then((s: MediaStream) => { tag(src, s.getTracks()); return s; });
        if (r instanceof MediaStream) tag(src, r.getTracks());
        else if (r?.stream instanceof MediaStream) tag(src, r.stream.getTracks());
        return r;
      };
    };
    wrapStream(navigator.mediaDevices, 'getUserMedia', 'getUserMedia');
    wrapStream(navigator.mediaDevices, 'getDisplayMedia', 'getDisplayMedia');
    wrapStream(MediaStream.prototype, 'clone', 'MediaStream.clone');
    wrapStream(HTMLCanvasElement.prototype, 'captureStream', 'canvas.captureStream');
    wrapStream(AudioContext.prototype, 'createMediaStreamDestination', 'createMediaStreamDestination');
    const tc = MediaStreamTrack.prototype.clone;
    MediaStreamTrack.prototype.clone = function () { const c = tc.call(this); tag('MediaStreamTrack.clone', [c]); return c; };
    (window as any).__live = (from = 0, to?: number) => all.slice(from, to).filter(x => x.t.readyState === 'live').map(x => `${x.src}:${x.t.kind}`);
  });
  if (init) await page.addInitScript(init);
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__FRAMECUT_E2E__);
}
const micBox = (page: Page) => page.getByRole('combobox', { name: 'Microphone' });
const pickMic = async (page: Page, n = 1) => {
  await micBox(page).selectOption(await micBox(page).locator('option').nth(n).getAttribute('value') as string);
};
/** Preflight is in its riskiest phase: the encoder warm-up recorder holds a clone of the mono output. */
const inWarmup = (page: Page) => page.waitForFunction(() => (window as any).__FRAMECUT_PREFLIGHT__?.state === 'running'
  && (window as any).__tracks.filter((x: any) => x.src === 'MediaStream.clone').length >= 2, null, { timeout: 10000, polling: 1 });
const count = (page: Page) => page.evaluate(() => (window as any).__tracks.length as number);
const liveOf = (page: Page, from = 0, to?: number) => page.evaluate(([f, e]) => (window as any).__live(f, e ?? undefined), [from, to ?? null] as const);
const expectNoneLive = async (page: Page, from = 0, to?: number) => {
  expect(await liveOf(page, from, to), 'immediately').toEqual([]);
  await page.waitForTimeout(400);
  expect(await liveOf(page, from, to), 'after 400 ms').toEqual([]);
};

test('mic Off during the preflight warm-up leaves no live track', async ({ page }) => {
  await boot(page);
  await pickMic(page);
  await inWarmup(page);
  await micBox(page).selectOption({ index: 0 });
  await expectNoneLive(page);
});

test('changing the mic device during the warm-up stops every track of the old mic', async ({ page }) => {
  await boot(page);
  await pickMic(page, 1);
  await inWarmup(page);
  const before = await count(page);
  await pickMic(page, 2);
  await expectNoneLive(page, 0, before);
});

test('pressing Record (picker returns) during the warm-up stops every preflight track', async ({ page }) => {
  await boot(page);
  await pickMic(page);
  await inWarmup(page);
  const before = await count(page);
  await page.getByRole('button', { name: 'Start Recording' }).click();
  await expect(page.getByRole('button', { name: 'Stop Sharing' })).toBeVisible({ timeout: 10000 });
  // Only the preview mic itself may stay live while recording; every preflight track is gone.
  const live = (await liveOf(page, 0, before)).filter((s: string) => s !== 'getUserMedia:audio');
  expect(live, 'immediately').toEqual([]);
  await page.waitForTimeout(400);
  expect((await liveOf(page, 0, before)).filter((s: string) => s !== 'getUserMedia:audio'), 'after 400 ms').toEqual([]);
  await page.getByRole('button', { name: 'Stop Sharing' }).click();
});

test('pagehide during the warm-up leaves no live track', async ({ page }) => {
  await boot(page);
  await pickMic(page);
  await inWarmup(page);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  await expectNoneLive(page);
});

test('a preflight error leaves only the preview mic live, and mic Off then leaves none', async ({ page }) => {
  await boot(page, () => { HTMLCanvasElement.prototype.captureStream = () => { throw new Error('no captureStream'); }; });
  await pickMic(page);
  await page.waitForFunction(() => (window as any).__FRAMECUT_PREFLIGHT__?.state === 'failed', null, { timeout: 10000 });
  expect(await liveOf(page)).toEqual(['getUserMedia:audio']);
  await page.waitForTimeout(400);
  expect(await liveOf(page)).toEqual(['getUserMedia:audio']);
  await micBox(page).selectOption({ index: 0 });
  await expectNoneLive(page);
});
