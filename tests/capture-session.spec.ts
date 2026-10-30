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

// ---- #28 QA B1/W2: cleanup, double-stop and error paths ----

const settle = (page: any) => page.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 100))));
const snap = async (page: any) => { await settle(page); return page.evaluate(() => (window as any).__FRAMECUT_E2E__.getSnapshot()); };

/** Boot with every getDisplayMedia stream kept in window.__streams, and optional MediaRecorder faults. */
async function bootCapture(page: any, faults: { startThrowsOnce?: boolean; ctorThrowsOnce?: boolean; stopIgnoredOnce?: boolean; slowCtorMs?: number } = {}) {
  await page.addInitScript((faults: any) => {
    (window as any).__FRAMECUT_E2E_ENABLED__ = true;
    try { localStorage.removeItem('framecut-project-v1'); } catch {}
    (window as any).__alerts = [];
    window.alert = (m: any) => { (window as any).__alerts.push(String(m)); };
    (window as any).__streams = [];
    const md = navigator.mediaDevices;
    const gdm = md.getDisplayMedia.bind(md);
    md.getDisplayMedia = async (c: any) => { const s = await gdm(c); (window as any).__streams.push(s); return s; };
    const Orig = window.MediaRecorder;
    let startThrow = !!faults.startThrowsOnce, ctorThrow = !!faults.ctorThrowsOnce, stopIgnore = !!faults.stopIgnoredOnce;
    class Faulty extends Orig {
      constructor(s: MediaStream, o?: MediaRecorderOptions) {
        if (ctorThrow) { ctorThrow = false; throw new DOMException('E2E: constructor failed', 'NotSupportedError'); }
        super(s, o);
        if (faults.slowCtorMs) { const t = performance.now(); while (performance.now() - t < faults.slowCtorMs) { /* busy */ } }
      }
      start(ts?: number) {
        if (startThrow) { startThrow = false; throw new DOMException('E2E: start failed', 'InvalidStateError'); }
        return super.start(ts);
      }
      stop() {
        if (stopIgnore) { stopIgnore = false; return; } // onstop never fires for this stop() call
        return super.stop();
      }
    }
    (window as any).MediaRecorder = Faulty;
  }, faults);
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__FRAMECUT_E2E__);
}

const liveTracks = (page: any, index?: number) => page.evaluate((index: number | undefined) => {
  const streams: MediaStream[] = (window as any).__streams;
  const list = index === undefined ? streams : [streams[index]];
  return list.flatMap(s => s.getTracks()).filter(t => t.readyState === 'live').length;
}, index);
const endStream = (page: any, index: number) => page.evaluate((i: number) => {
  const s: MediaStream = (window as any).__streams[i];
  s.getTracks().forEach(t => { t.stop(); t.dispatchEvent(new Event('ended')); });
}, index);

async function record(page: any, ms: number) {
  await page.getByRole('button', { name: 'Start Recording' }).click();
  await expect(page.getByRole('button', { name: 'Stop Sharing' })).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(ms);
}

for (const fault of ['startThrowsOnce', 'ctorThrowsOnce'] as const) {
  test(`failed recorder start (${fault}) stops every track; a stale ended neither hangs nor cuts the next recording`, async ({ page }) => {
    await bootCapture(page, { [fault]: true });
    await page.getByRole('button', { name: 'Start Recording' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__alerts.length)).toBe(1);
    expect(await page.evaluate(() => (window as any).__alerts[0])).toMatch(/Failed to start screen recording/);
    // Nothing of the failed attempt is still capturing.
    expect(await liveTracks(page, 0)).toBe(0);
    await expect(page.getByRole('button', { name: 'Start Recording' })).toBeVisible();

    // Retry; while it records, the failed attempt's stream fires `ended`: the new recording continues.
    await record(page, 800);
    await endStream(page, 0);
    await page.waitForTimeout(1200);
    await expect(page.getByRole('button', { name: 'Stop Sharing' })).toBeVisible();
    await page.getByRole('button', { name: 'Stop Sharing' }).click();
    await page.waitForFunction(() => (window as any).__FRAMECUT_E2E__.getSnapshot().hasMainVideo, null, { timeout: 15000 });
    const cap = await page.evaluate(() => (window as any).__FRAMECUT_LAST_CAPTURE__);
    expect(cap.durationHint).toBeGreaterThan(1.8);
    expect(await liveTracks(page)).toBe(0);
  });
}

test('Stop + track ended together: one clip, all tracks stopped', async ({ page }) => {
  await bootCapture(page);
  await record(page, 1500);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Stop Sharing'))!;
    btn.click();
    const s: MediaStream = (window as any).__streams[0];
    s.getVideoTracks().forEach(t => { t.stop(); t.dispatchEvent(new Event('ended')); });
    btn.click();
  });
  await page.waitForFunction(() => (window as any).__FRAMECUT_E2E__.getSnapshot().hasMainVideo, null, { timeout: 15000 });
  await page.waitForTimeout(800);
  expect(await liveTracks(page)).toBe(0);
  // Exactly one recording was completed and handed to the editor.
  expect(await page.evaluate(() => (window as any).__FRAMECUT_LAST_CAPTURE__.completedCount)).toBe(1);
});

test('normal Stop stops every captured track (video and audio)', async ({ page }) => {
  await bootCapture(page);
  await record(page, 1200);
  expect(await liveTracks(page, 0)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Stop Sharing' }).click();
  await page.waitForFunction(() => (window as any).__FRAMECUT_E2E__.getSnapshot().hasMainVideo, null, { timeout: 15000 });
  expect(await liveTracks(page, 0)).toBe(0);
});

test('a recorder whose onstop never fires does not hang Stop', async ({ page }) => {
  await bootCapture(page, { stopIgnoredOnce: true });
  await record(page, 1200);
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Stop Sharing' }).click();
  await page.waitForFunction(() => (window as any).__FRAMECUT_E2E__.getSnapshot().hasMainVideo, null, { timeout: 10000 });
  expect(Date.now() - t0).toBeLessThan(8000);
  await expect(page.getByRole('button', { name: 'Stop Sharing' })).toBeHidden();
  expect(await liveTracks(page)).toBe(0);
  // QA W1: the clip ends at the Stop time, not when the 4 s timeout fired.
  const cap = await page.evaluate(() => (window as any).__FRAMECUT_LAST_CAPTURE__);
  expect(cap.durationHint).toBeGreaterThan(1.0);
  expect(cap.durationHint).toBeLessThan(2.2);
});

test('events and markers are on the screen recording timeline (late recorder start, marker)', async ({ page }) => {
  // A slow MediaRecorder constructor makes the screen recorder start ~0.4 s after the session clock.
  await bootCapture(page, { slowCtorMs: 400 });
  await record(page, 1000);
  await page.getByRole('button', { name: /Marker/ }).click();
  await page.waitForTimeout(300);
  await page.mouse.click(400, 300);
  await page.getByRole('button', { name: 'Stop Sharing' }).click();
  await page.waitForFunction(() => (window as any).__FRAMECUT_E2E__.getSnapshot().hasMainVideo, null, { timeout: 15000 });
  const cap = await page.evaluate(() => (window as any).__FRAMECUT_LAST_CAPTURE__);
  const s = await snap(page);
  expect(cap.sources[0].requestedOffset).toBeGreaterThan(0.3);
  const clicks = s.recordingEvents.filter((e: any) => e.type === 'click');
  expect(clicks.length).toBeGreaterThanOrEqual(2); // marker + mouse click
  for (const e of s.recordingEvents) {
    expect(e.time).toBeGreaterThanOrEqual(0);
    // Re-based onto the recording: nothing can be later than the recording itself.
    expect(e.time).toBeLessThanOrEqual(cap.durationHint + 0.02);
  }
  // The marker was pressed ~1 s into the recording (well under 1.4 s session time).
  expect(clicks[0].time).toBeGreaterThan(0.5);
  expect(clicks[0].time).toBeLessThan(cap.durationHint);
});

test("a finished session's stream firing ended later does not stop the next recording", async ({ page }) => {
  await bootCapture(page);
  await record(page, 1000);
  await page.getByRole('button', { name: 'Stop Sharing' }).click();
  await page.waitForFunction(() => (window as any).__FRAMECUT_E2E__.getSnapshot().hasMainVideo, null, { timeout: 15000 });
  // Back to the landing screen (remove the recording), record again.
  await page.locator('[title="Remove"]').first().click();
  await expect(page.getByRole('button', { name: 'Start Recording' })).toBeVisible({ timeout: 5000 });
  await record(page, 800);
  await endStream(page, 0); // late `ended` from the first session's stream
  await page.waitForTimeout(1200);
  await expect(page.getByRole('button', { name: 'Stop Sharing' })).toBeVisible();
  await page.getByRole('button', { name: 'Stop Sharing' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__FRAMECUT_LAST_CAPTURE__.completedCount)).toBe(2);
  expect(await page.evaluate(() => (window as any).__FRAMECUT_LAST_CAPTURE__.durationHint)).toBeGreaterThan(1.8);
});

// ---- #28 QA W1/W2: each safeguard of the session on its own (fake recorders, no hook) ----

/** Runs `body` in the page with createCaptureSession, a scriptable FakeRecorder and fake streams. */
async function withSession(page: any, body: string, arg: any = {}) {
  await page.goto('/');
  return page.evaluate(async ({ body, arg }: any) => {
    // @ts-ignore in-page Vite module
    const m = await import('/hooks/useCaptureSession.ts');
    const plans: any[] = arg.plans ?? [];
    const recs: any[] = [];
    class FakeRecorder {
      static isTypeSupported() { return true; }
      state = 'inactive'; mimeType: string; stopCalls = 0; plan: any;
      onstart: any; onstop: any; onerror: any; ondataavailable: any;
      constructor(public stream: any, o?: any) { this.mimeType = o?.mimeType ?? ''; this.plan = plans[recs.length] ?? {}; recs.push(this); }
      start() {
        if (this.plan.startThrows) throw new DOMException('fake start failed', 'InvalidStateError');
        this.state = 'recording'; setTimeout(() => this.onstart?.(), 0);
      }
      stop() {
        this.stopCalls++;
        if (this.plan.stopThrows) throw new DOMException('fake stop failed', 'InvalidStateError');
        this.state = 'inactive';
        if (this.plan.errorInsteadOfStop) { setTimeout(() => this.onerror?.(new Event('error')), 10); return; }
        if (this.plan.noOnstop) return;
        setTimeout(() => { this.ondataavailable?.({ data: new Blob(['x']) }); this.onstop?.(); }, 10);
      }
    }
    const stream = (n = 2) => {
      const tracks = Array.from({ length: n }, () => ({ readyState: 'live', stop() { this.readyState = 'ended'; } }));
      return { getTracks: () => tracks, tracks };
    };
    const live = (s: any) => s.tracks.filter((t: any) => t.readyState === 'live').length;
    const fn = new Function('m', 'FakeRecorder', 'recs', 'stream', 'live', 'arg', `return (async () => { ${body} })();`);
    return fn(m, FakeRecorder, recs, stream, live, arg);
  }, { body, arg });
}

test('session: a failed start stops every track of its sources by itself (QA N1)', async ({ page }) => {
  const r = await withSession(page, `
    const s = m.createCaptureSession({ MediaRecorder: FakeRecorder });
    const a = stream(2);
    let threw = false;
    try { s.start([{ id: 'screen', kind: 'video', stream: a }]); } catch { threw = true; }
    return { threw, live: live(a), active: s.isActive(), stop: await s.stop() };
  `, { plans: [{ startThrows: true }] });
  expect(r).toEqual({ threw: true, live: 0, active: false, stop: null });
});

test('session: when a later source fails to start, the already started recorder is stopped (QA N3)', async ({ page }) => {
  const r = await withSession(page, `
    const s = m.createCaptureSession({ MediaRecorder: FakeRecorder });
    const a = stream(2), b = stream(1);
    try { s.start([{ id: 'screen', kind: 'video', stream: a }, { id: 'mic', kind: 'audio', stream: b }]); } catch {}
    return { screenState: recs[0].state, screenStops: recs[0].stopCalls, liveA: live(a), liveB: live(b) };
  `, { plans: [{}, { startThrows: true }] });
  expect(r).toEqual({ screenState: 'inactive', screenStops: 1, liveA: 0, liveB: 0 });
});

test('session: concurrent stop() calls produce one result; the second gets null (QA N5)', async ({ page }) => {
  const r = await withSession(page, `
    const s = m.createCaptureSession({ MediaRecorder: FakeRecorder });
    s.start([{ id: 'screen', kind: 'video', stream: stream() }]);
    await new Promise(r => setTimeout(r, 50));
    const [x, y] = await Promise.all([s.stop(), s.stop()]);
    return { first: x ? x.sources.length : null, second: y, stops: recs[0].stopCalls };
  `);
  expect(r).toEqual({ first: 1, second: null, stops: 1 });
});

test('session: recorder.stop() throwing still finishes Stop promptly (QA N7)', async ({ page }) => {
  const r = await withSession(page, `
    const s = m.createCaptureSession({ MediaRecorder: FakeRecorder });
    const a = stream();
    s.start([{ id: 'screen', kind: 'video', stream: a }]);
    await new Promise(r => setTimeout(r, 50));
    const t = performance.now();
    const res = await s.stop();
    return { ms: performance.now() - t, sources: res.sources.length, live: live(a) };
  `, { plans: [{ stopThrows: true }] });
  expect(r.sources).toBe(1);
  expect(r.live).toBe(0);
  expect(r.ms).toBeLessThan(500); // default 4 s timeout must not be what ends it
});

test('session: a recorder error instead of onstop finishes Stop promptly (QA N9)', async ({ page }) => {
  const r = await withSession(page, `
    const s = m.createCaptureSession({ MediaRecorder: FakeRecorder });
    s.start([{ id: 'screen', kind: 'video', stream: stream() }]);
    await new Promise(r => setTimeout(r, 50));
    const t = performance.now();
    const res = await s.stop();
    return { ms: performance.now() - t, sources: res.sources.length };
  `, { plans: [{ errorInsteadOfStop: true }] });
  expect(r.sources).toBe(1);
  expect(r.ms).toBeLessThan(500);
});

test('session: on the onstop-timeout path the stop offset is the session stop time, not the timeout (QA W1)', async ({ page }) => {
  const r = await withSession(page, `
    const s = m.createCaptureSession({ MediaRecorder: FakeRecorder, stopTimeoutMs: 1500 });
    s.start([{ id: 'screen', kind: 'video', stream: stream() }]);
    await new Promise(r => setTimeout(r, 400));
    const res = await s.stop();
    const src = res.sources[0];
    return { duration: src.stopOffset - src.requestedOffset };
  `, { plans: [{ noOnstop: true }] });
  expect(r.duration).toBeGreaterThan(0.35);
  expect(r.duration).toBeLessThan(0.6); // the timeout fires at ~1.9 s
});

test('hook: a failure before the session starts still stops the screen share (QA N11)', async ({ page }) => {
  await bootCapture(page);
  await page.evaluate(() => {
    const orig = window.setInterval;
    let armed = true;
    (window as any).setInterval = (fn: any, ms?: number, ...rest: any[]) => {
      if (armed && ms === 1000) { armed = false; throw new Error('E2E: timer failed'); }
      return orig(fn, ms, ...rest);
    };
  });
  await page.getByRole('button', { name: 'Start Recording' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__alerts.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__streams.length)).toBe(1);
  expect(await liveTracks(page)).toBe(0);
});
