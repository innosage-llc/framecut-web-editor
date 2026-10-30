import { test, expect } from '@playwright/test';

// #28 PR-A: common capture clock, MediaRecorder mime picker and per-recorder start offsets.

test('mime picker prefers supported candidates and falls back to browser default', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    // @ts-ignore in-page Vite module
    const m = await import('/utils/recorderMime.ts');
    return {
      real: m.pickRecorderMimeType('video'),
      realAudio: m.pickRecorderMimeType('audio'),
      safariLike: m.pickRecorderMimeType('video', (t: string) => t.startsWith('video/mp4')),
      none: m.pickRecorderMimeType('video', () => false),
      throws: m.pickRecorderMimeType('audio', (t: string) => { if (t.includes('webm')) throw new Error('x'); return t === 'audio/ogg;codecs=opus'; }),
      blobType: m.blobTypeFor('video', 'video/mp4;codecs=avc1', ''),
      blobDefault: m.blobTypeFor('audio', '', ''),
      ext: [m.fileExtensionFor('video/mp4'), m.fileExtensionFor('audio/mp4'), m.fileExtensionFor('audio/ogg'), m.fileExtensionFor('video/webm')],
    };
  });
  expect(r.real).toBe('video/webm;codecs=vp9,opus');
  expect(r.realAudio).toBe('audio/webm;codecs=opus');
  expect(r.safariLike).toBe('video/mp4;codecs=avc1,mp4a.40.2');
  expect(r.none).toBe('');
  expect(r.throws).toBe('audio/ogg;codecs=opus');
  expect(r.blobType).toBe('video/mp4');
  expect(r.blobDefault).toBe('audio/webm');
  expect(r.ext).toEqual(['mp4', 'm4a', 'ogg', 'webm']);
});

test('capture clock is monotonic and re-bases session time onto media time', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    // @ts-ignore in-page Vite module
    const c = await import('/utils/captureClock.ts');
    let t = 1000;
    const clock = c.createCaptureClock(() => t);
    t = 3500;
    return {
      now: clock.now(),
      conv: clock.toSessionSeconds(2000),
      rebased: c.sessionToMediaTime(2.5, 0.1),
      early: c.sessionToMediaTime(0.05, 0.1),
      negOffset: c.sessionToMediaTime(1, -0.2),
    };
  });
  expect(r.now).toBeCloseTo(2.5, 6);
  expect(r.conv).toBeCloseTo(1, 6);
  expect(r.rebased).toBeCloseTo(2.4, 6);
  expect(r.early).toBe(0);
  expect(r.negOffset).toBe(1);
});

test('screen recording records start offset, real mime type and re-based events', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__FRAMECUT_E2E_ENABLED__ = true;
    try { localStorage.removeItem('framecut-project-v1'); } catch {}
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start Recording' }).click();
  await expect(page.getByRole('button', { name: 'Stop Sharing' })).toBeVisible({ timeout: 10000 });
  await page.mouse.move(200, 200);
  await page.waitForTimeout(800);
  await page.mouse.click(300, 300);
  await page.waitForTimeout(2200);
  await page.getByRole('button', { name: 'Stop Sharing' }).click();
  await page.waitForFunction(() => !!(window as any).__FRAMECUT_LAST_CAPTURE__, null, { timeout: 15000 });
  const cap = await page.evaluate(() => (window as any).__FRAMECUT_LAST_CAPTURE__);
  expect(cap.sources).toHaveLength(1);
  const screen = cap.sources[0];
  expect(screen.id).toBe('screen');
  expect(screen.mimeType).toBe('video/webm');
  expect(screen.size).toBeGreaterThan(0);
  expect(screen.requestedOffset).toBeGreaterThanOrEqual(0);
  expect(screen.requestedOffset).toBeLessThan(0.5);
  // With a real (fake-device) screen stream the recorder starts promptly after start().
  expect(screen.startOffset).toBeGreaterThanOrEqual(screen.requestedOffset);
  expect(screen.startOffset - screen.requestedOffset).toBeLessThan(2);
  expect(screen.stopOffset).toBeGreaterThan(screen.requestedOffset + 2.5);
  expect(cap.durationHint).toBeCloseTo(screen.stopOffset - screen.requestedOffset, 6);
  await page.waitForFunction(() => (window as any).__FRAMECUT_E2E__?.getSnapshot().hasMainVideo, null, { timeout: 15000 });
  const snap = await page.evaluate(() => (window as any).__FRAMECUT_E2E__.getSnapshot());
  const times: number[] = snap.recordingEvents.map((e: any) => e.time);
  expect(times.length).toBeGreaterThan(0);
  for (const t of times) {
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThanOrEqual(cap.durationHint + 0.05);
  }
  expect(snap.recordingEvents.some((e: any) => e.type === 'click')).toBe(true);
});
