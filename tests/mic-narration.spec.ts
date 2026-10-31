import { test, expect, Page } from '@playwright/test';
import fs from 'fs';

// #28 PR-B: microphone narration (macOS #64 behaviour): setup with Off defaults, linked edits,
// A1/A2/A3 lane mutes, narration in the export mix, sync, disconnect, one undo step per import.

// The seam's getSnapshot() is rebuilt after each React commit, so wait a moment after mutations.
const settle = (page: Page) => page.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 100))));
const E2E = async (page: Page) => { await settle(page); return page.evaluate(() => (window as any).__FRAMECUT_E2E__.getSnapshot()); };
const callApi = async (page: Page, fn: string, ...args: any[]) => {
  const r = await page.evaluate(([fn, args]) => (window as any).__FRAMECUT_E2E__[fn as string](...(args as any[])), [fn, args] as const);
  await settle(page);
  return r;
};

async function boot(page: Page, init?: () => void) {
  await page.addInitScript(() => {
    (window as any).__FRAMECUT_E2E_ENABLED__ = true;
    try { localStorage.removeItem('framecut-project-v1'); } catch {}
    (window as any).__alerts = [];
    window.alert = (m: any) => { (window as any).__alerts.push(String(m)); };
  });
  if (init) await page.addInitScript(init);
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__FRAMECUT_E2E__);
}

/** Load the 10 s test video plus a synthetic narration WAV with one beep at media time `beepAt`. */
async function loadNarrated(page: Page, timeOffset: number, beepAt = 1.0, waitForLoad = true) {
  const b64 = fs.readFileSync('tests/fixtures/e2e-testsrc-10s.webm').toString('base64');
  await page.evaluate(async ([b64, timeOffset, beepAt]) => {
    const bin = atob(b64 as string); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    // 48 kHz mono 16-bit WAV, 6 s, a 100 ms 1 kHz beep at beepAt.
    const sr = 48000, n = sr * 6;
    const buf = new ArrayBuffer(44 + n * 2); const v = new DataView(buf);
    const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    const b0 = Math.round((beepAt as number) * sr), b1 = b0 + sr / 10;
    for (let i = b0; i < b1; i++) v.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * 1000 * i / sr) * 16000), true);
    await (window as any).__FRAMECUT_E2E__.loadWithNarration(new Blob([u], { type: 'video/webm' }), [], 10, new Blob([buf], { type: 'audio/wav' }), timeOffset, 6);
  }, [b64, timeOffset, beepAt] as const);
  if (waitForLoad) await page.waitForFunction(() => (window as any).__FRAMECUT_E2E__.getSnapshot().narrationClips.length > 0);
}

/** First time (s) where the rendered mix rises above `thr` (10 ms resolution), or null. */
async function onset(page: Page, thr = 0.05): Promise<number | null> {
  await settle(page);
  const r = await page.evaluate(() => (window as any).__FRAMECUT_E2E__.renderAudioEnvelope());
  if (!r) return null;
  const i = r.env.findIndex((x: number) => x > thr);
  return i < 0 ? null : i / 100;
}

test.describe('linked recording clips (unit)', () => {
  test('companions follow move, trim, split, speed and delete; keep their own mute', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async () => {
      // @ts-ignore in-page Vite module
      const L = await import('/utils/linkedRecordingClips.ts');
      const screen = { id: 's1', sourceStart: 0, sourceEnd: 10, offset: 0, speed: 1, mediaType: 'main', recordingLinkID: 'g' };
      const narr = { id: 'n1', sourceStart: 0, sourceEnd: 10, offset: 0, speed: 1, mediaType: 'narration', recordingLinkID: 'g', muted: true };
      const other = { id: 'x', sourceStart: 0, sourceEnd: 3, offset: 20, speed: 1, mediaType: 'narration', recordingLinkID: 'h' };
      const c = (o: any[], n: any[], t: any[]) => L.linkedCompanions(o, n, t);
      const moved = c([screen], [{ ...screen, offset: 2 }], [narr, other]);
      const trimmed = c([screen], [{ ...screen, sourceStart: 1.5 }], [narr]);
      const split = c([screen], [{ ...screen, sourceEnd: 4 }, { ...screen, id: 's2', sourceStart: 4, offset: 4 }], [narr]);
      const speed = c([screen], [{ ...screen, speed: 2 }], [narr]);
      const deleted = c([screen], [], [narr, other]);
      const unchanged = c([screen], [{ ...screen }], [narr]);
      return { moved, trimmed, split, speed, deleted, unchangedSame: unchanged[0] === narr };
    });
    expect(r.moved.find((x: any) => x.recordingLinkID === 'g')).toMatchObject({ id: 'n1', offset: 2, muted: true });
    expect(r.moved.find((x: any) => x.id === 'x')).toMatchObject({ offset: 20 });
    expect(r.trimmed).toEqual([expect.objectContaining({ id: 'n1', sourceStart: 1.5, sourceEnd: 10, muted: true })]);
    expect(r.split).toHaveLength(2);
    expect(r.split.map((x: any) => [x.offset, x.sourceStart, x.sourceEnd, x.muted])).toEqual([[0, 0, 4, true], [4, 4, 10, true]]);
    expect(new Set(r.split.map((x: any) => x.id)).size).toBe(2);
    expect(r.speed[0]).toMatchObject({ speed: 2, muted: true });
    expect(r.deleted.map((x: any) => x.id)).toEqual(['x']);
    expect(r.unchangedSame).toBe(true);
  });

  test('alignment and narration window math', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async () => {
      // @ts-ignore
      const C = await import('/utils/captureClock.ts');
      // @ts-ignore
      const A = await import('/utils/audioLanes.ts');
      const clip = { id: 'n', sourceStart: 0, sourceEnd: 10, offset: 0, speed: 1, mediaType: 'narration' as const };
      return {
        // start events lagging by encoder latency (< LATE_START_S) don't move media time 0
        encoderLag: C.companionTimeOffset({ requestedOffset: 0, startOffset: 0.1, stopOffset: 5 }, { requestedOffset: 0.02, startOffset: 0.15, stopOffset: 5 }),
        // a source whose start event is far later really began late
        late: C.companionTimeOffset({ requestedOffset: 0, startOffset: 0.1, stopOffset: 5 }, { requestedOffset: 0.02, startOffset: 0.6, stopOffset: 5 }),
        bogusScreenStart: C.companionTimeOffset({ requestedOffset: 0, startOffset: 5, stopOffset: 5 }, { requestedOffset: 0, startOffset: 0.05, stopOffset: 5 }),
        winLate: A.narrationWindow(clip, 0.25),
        winTrim: A.narrationWindow({ ...clip, sourceStart: 1, offset: 3, speed: 2 }, 0.25, 6),
        winEarly: A.narrationWindow(clip, -0.5),
        silent: A.narrationWindow({ ...clip, sourceEnd: 0.2 }, 0.25),
        roles: (['main', 'intro', 'audio', 'narration'] as const).map(m => A.audioRoleOf({ mediaType: m })),
      };
    });
    expect(r.encoderLag).toBeCloseTo(0.02, 6);
    expect(r.late).toBeCloseTo(0.6, 6);
    expect(r.bogusScreenStart).toBeCloseTo(0, 6);
    expect(r.winLate).toEqual({ when: 0.25, bufferOffset: 0, playDuration: 9.75 });
    expect(r.winTrim.when).toBeCloseTo(3, 6);
    expect(r.winTrim.bufferOffset).toBeCloseTo(0.75, 6);
    expect(r.winTrim.playDuration).toBeCloseTo(5.25, 6);
    expect(r.winEarly).toEqual({ when: 0, bufferOffset: 0.5, playDuration: 10 });
    expect(r.silent).toBeNull();
    expect(r.roles).toEqual(['system', 'system', 'music', 'narration']);
  });
});

test.describe('narration in the editor', () => {
  test('import is one undo step, linked, and shows the A2 lane', async ({ page }) => {
    await boot(page);
    await loadNarrated(page, 0.25);
    let s = await E2E(page);
    expect(s.narration).toMatchObject({ timeOffset: 0.25, stored: true });
    expect(s.narrationClips).toHaveLength(1);
    expect(s.narrationClips[0].recordingLinkID).toBeTruthy();
    expect(s.linkedClips[0].recordingLinkID).toBe(s.narrationClips[0].recordingLinkID);
    await expect(page.getByTestId('narration-track')).toBeVisible();
    await expect(page.getByTestId('lane-mute-narration')).toBeVisible();
    await expect(page.getByTestId('lane-mute-system')).toBeVisible();
    await expect(page.getByTestId('lane-mute-music')).toBeVisible();
    await callApi(page, 'undo');
    s = await E2E(page);
    expect(s.hasMainVideo).toBe(false);
    expect(s.narration).toBeNull();
    expect(s.narrationClips).toHaveLength(0);
    await callApi(page, 'redo');
    s = await E2E(page);
    expect(s.narrationClips).toHaveLength(1);
  });

  test('failed import rolls back: no state change, no undo step, no stored media', async ({ page }) => {
    await boot(page);
    const count = () => page.evaluate(() => new Promise<number>(res => {
      const req = indexedDB.open('FrameCutDB', 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('assets')) req.result.createObjectStore('assets'); };
      req.onsuccess = () => { const c = req.result.transaction('assets').objectStore('assets').count(); c.onsuccess = () => { res(c.result); req.result.close(); }; };
    }));
    const before = await count();
    await page.evaluate(() => { (window as any).__FRAMECUT_E2E_FAIL_IMPORT__ = true; });
    await loadNarrated(page, 0, 1.0, false);
    await page.evaluate(() => { (window as any).__FRAMECUT_E2E_FAIL_IMPORT__ = false; });
    const s = await E2E(page);
    expect(s.hasMainVideo).toBe(false);
    expect(s.narrationClips).toHaveLength(0);
    await expect.poll(count).toBe(before);
    const alerts = await page.evaluate(() => (window as any).__alerts);
    expect(alerts.join(' ')).toMatch(/simulated import failure/);
  });

  test('sync: narration lands at its measured offset in the export mix and follows linked edits', async ({ page }) => {
    await boot(page);
    await loadNarrated(page, 0.25, 1.0);
    const api = (fn: string, ...args: any[]) => callApi(page, fn, ...args);
    // Isolate narration from the test video's own audio.
    await api('setLaneMuted', 'system', true);
    // Beep at narration media 1.0 s, mic started 0.25 s after the screen -> timeline 1.25 s.
    // Tolerance: one 30 fps frame (macOS acceptance) + 10 ms envelope bin.
    const tol = 1 / 30 + 0.01;
    expect(Math.abs((await onset(page))! - 1.25)).toBeLessThanOrEqual(tol);

    const s = await E2E(page);
    const screenId = s.linkedClips[0].id;
    // Trim 0.5 s off the start of the screen clip: narration trims with it.
    await api('updateClip', screenId, { sourceStart: 0.5 });
    let snap = await E2E(page);
    expect(snap.narrationClips[0]).toMatchObject({ sourceStart: 0.5 });
    expect(Math.abs((await onset(page))! - 0.75)).toBeLessThanOrEqual(tol);

    // Speed 2x on the screen clip: narration follows (beep at 0.75 / 2).
    await api('select', { type: 'clip', id: screenId });
    await api('setSelectedSpeed', 2);
    snap = await E2E(page);
    expect(snap.narrationClips[0].speed).toBe(2);
    expect(Math.abs((await onset(page))! - 0.375)).toBeLessThanOrEqual(tol);
    await api('undo');

    // Lane mute (A2) and per-clip mute both silence narration; undo restores it.
    await api('setLaneMuted', 'narration', true);
    expect(await onset(page)).toBeNull();
    expect((await E2E(page)).mutedAudioRoles).toEqual(['system', 'narration']);
    await api('undo');
    expect(await onset(page)).not.toBeNull();
    const nid = (await E2E(page)).narrationClips[0].id;
    await api('toggleNarrationClipMute', nid);
    expect(await onset(page)).toBeNull();
    await api('undo');
    expect(await onset(page)).not.toBeNull();
  });

  test('split and delete through a selected narration clip edit the whole recording', async ({ page }) => {
    await boot(page);
    await loadNarrated(page, 0);
    const api = (fn: string, ...args: any[]) => callApi(page, fn, ...args);
    let s = await E2E(page);
    await api('seek', 4);
    await api('select', { type: 'narration', id: s.narrationClips[0].id });
    await api('split');
    s = await E2E(page);
    expect(s.clips.filter((c: any) => c.mediaType === 'main')).toHaveLength(2);
    expect(s.narrationClips).toHaveLength(2);
    expect(s.narrationClips.map((c: any) => [c.offset, c.sourceStart])).toEqual([[0, 0], [4, 4]]);
    // Delete the first half via its narration clip: both tracks ripple together.
    await api('select', { type: 'narration', id: s.narrationClips[0].id });
    await api('deleteSelected');
    s = await E2E(page);
    expect(s.clips.filter((c: any) => c.mediaType === 'main')).toHaveLength(1);
    expect(s.narrationClips).toHaveLength(1);
    expect(s.narrationClips[0]).toMatchObject({ offset: 0, sourceStart: 4 });
  });
});

test.describe('recording setup and capture (Chromium fake devices)', () => {
  test('mic and camera are Off by default; picking a mic shows a live meter; camera previews', async ({ page }) => {
    await boot(page);
    const mic = page.getByRole('combobox', { name: 'Microphone' });
    const cam = page.getByRole('combobox', { name: 'Camera' });
    await expect(mic).toHaveValue('');
    await expect(cam).toHaveValue('');
    await expect(page.getByRole('meter', { name: 'Microphone level' })).toHaveCount(0);
    const micOption = await mic.locator('option').nth(1).getAttribute('value');
    await mic.click(); await page.keyboard.press('Escape');
    await mic.selectOption(micOption!);
    const meter = page.getByRole('meter', { name: 'Microphone level' });
    await expect(meter).toBeVisible();
    await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow')), { timeout: 10000 }).toBeGreaterThan(0);
    const camOption = await cam.locator('option').nth(1).getAttribute('value');
    await cam.selectOption(camOption!);
    await expect(page.getByLabel('Camera preview')).toBeVisible();
    await expect.poll(() => page.getByLabel('Camera preview').evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);
    await mic.selectOption('');
    await expect(meter).toHaveCount(0);
  });

  test('denied microphone permission shows a clear error and falls back to Off', async ({ page }) => {
    await boot(page, () => {
      const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (c: any) => {
        if (c && c.audio) throw new DOMException('denied', 'NotAllowedError');
        return orig(c);
      };
    });
    const mic = page.getByRole('combobox', { name: 'Microphone' });
    await mic.selectOption(await mic.locator('option').nth(1).getAttribute('value') as string);
    await expect(page.getByRole('alert')).toContainText('Microphone access was denied');
    await expect(mic).toHaveValue('');
  });

  test('records screen + mic on one clock; mic disconnect keeps narration and the screen continues', async ({ page }) => {
    await boot(page, () => {
      const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      (window as any).__micTracks = [];
      navigator.mediaDevices.getUserMedia = async (c: any) => {
        const s = await orig(c);
        if (c && c.audio) (window as any).__micTracks.push(s.getAudioTracks()[0]);
        return s;
      };
    });
    const mic = page.getByRole('combobox', { name: 'Microphone' });
    await mic.selectOption(await mic.locator('option').nth(1).getAttribute('value') as string);
    await expect(page.getByRole('meter', { name: 'Microphone level' })).toBeVisible();
    await page.getByRole('button', { name: 'Start Recording' }).click();
    await expect(page.getByRole('button', { name: 'Stop Sharing' })).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2500);
    // Simulate the device disappearing: the UA would end the track and fire 'ended'.
    await page.evaluate(() => {
      const t = (window as any).__micTracks.at(-1) as MediaStreamTrack;
      t.stop(); t.dispatchEvent(new Event('ended'));
    });
    await expect(page.getByTestId('recording-notice')).toContainText('Microphone disconnected');
    await expect(page.getByRole('button', { name: 'Stop Sharing' })).toBeVisible();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Stop Sharing' }).click();
    await page.waitForFunction(() => (window as any).__FRAMECUT_E2E__?.getSnapshot().narrationClips.length > 0, null, { timeout: 15000 });
    const cap = await page.evaluate(() => (window as any).__FRAMECUT_LAST_CAPTURE__);
    const screen = cap.sources.find((x: any) => x.id === 'screen');
    const micSrc = cap.sources.find((x: any) => x.id === 'mic');
    expect(micSrc.kind).toBe('audio');
    expect(micSrc.mimeType).toBe('audio/webm');
    expect(micSrc.size).toBeGreaterThan(0);
    // Mic stopped at the disconnect, the screen kept going.
    expect(micSrc.stopOffset).toBeLessThan(screen.stopOffset - 1);
    expect(Math.abs(cap.narrationTimeOffset)).toBeLessThan(0.5);
    // macOS parity: mono 48 kHz regardless of the device (Chromium's fake device is stereo 44.1 kHz).
    expect(cap.micSettings).toMatchObject({ sampleRate: 48000, channelCount: 1 });
    const decodedChannels = await page.evaluate(async () => {
      const b = (window as any).__FRAMECUT_LAST_CAPTURE__.micBlob as Blob;
      const buf = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await b.arrayBuffer());
      return buf.numberOfChannels;
    });
    expect(decodedChannels).toBe(1);
    const s = await E2E(page);
    expect(s.narration.timeOffset).toBeCloseTo(cap.narrationTimeOffset, 6);
    expect(s.narrationClips[0].recordingLinkID).toBe(s.linkedClips[0].recordingLinkID);
    expect(s.duration).toBeGreaterThanOrEqual(3.5);
  });

  test('mic Off records the screen only (no narration lane)', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: 'Start Recording' }).click();
    await expect(page.getByRole('button', { name: 'Stop Sharing' })).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Stop Sharing' }).click();
    await page.waitForFunction(() => (window as any).__FRAMECUT_E2E__?.getSnapshot().hasMainVideo, null, { timeout: 15000 });
    const cap = await page.evaluate(() => (window as any).__FRAMECUT_LAST_CAPTURE__);
    expect(cap.sources.map((x: any) => x.id)).toEqual(['screen']);
    expect((await E2E(page)).narrationClips).toHaveLength(0);
    await expect(page.getByTestId('lane-mute-narration')).toHaveCount(0);
  });
});

// ---- #28 QA (PR #48): first-time permission, empty undo step, blob URL rollback, mic leak ----

/** Emulates a browser before permission: enumerateDevices hides ids/labels until getUserMedia succeeds. */
const noPermissionYet = () => {
  const md = navigator.mediaDevices;
  const enumerate = md.enumerateDevices.bind(md);
  const gum = md.getUserMedia.bind(md);
  (window as any).__gum = [];
  (window as any).__granted = { audio: false, video: false };
  md.enumerateDevices = async () => {
    const list = await enumerate();
    const g = (window as any).__granted;
    return list.map(d => {
      const ok = d.kind === 'audioinput' ? g.audio : d.kind === 'videoinput' ? g.video : true;
      return ok ? d : ({ deviceId: '', groupId: '', kind: d.kind, label: '', toJSON() { return this; } } as MediaDeviceInfo);
    });
  };
  md.getUserMedia = async (c: any) => {
    (window as any).__gum.push(JSON.parse(JSON.stringify(c)));
    const s = await gum(c);
    if (c?.audio) (window as any).__granted.audio = true;
    if (c?.video) (window as any).__granted.video = true;
    return s;
  };
};

test.describe('setup without granted permission', () => {
  test('mic: a generic "Microphone" entry asks for permission, then lists real devices', async ({ page }) => {
    await boot(page, noPermissionYet);
    const mic = page.getByRole('combobox', { name: 'Microphone' });
    await expect.poll(() => mic.locator('option').allTextContents()).toEqual(['Off', 'Microphone']);
    await expect(mic).toHaveValue('');
    expect(await page.evaluate(() => (window as any).__gum.length)).toBe(0);
    await mic.selectOption({ label: 'Microphone' });
    await expect(page.getByRole('meter', { name: 'Microphone level' })).toBeVisible();
    const calls = await page.evaluate(() => (window as any).__gum);
    expect(calls).toHaveLength(1);
    expect(calls[0].audio.deviceId).toBeUndefined(); // default device, no stale exact id
    // Re-enumerated with real ids and labels; the opened device is the selection.
    await expect.poll(async () => (await mic.locator('option').allTextContents()).includes('Microphone')).toBe(false);
    const labels = await mic.locator('option').allTextContents();
    expect(labels).not.toContain('Microphone');
    expect(labels.length).toBeGreaterThan(2); // the real devices are listed
    expect(await mic.inputValue()).not.toBe('');
    const selected = await mic.locator('option:checked').textContent();
    expect(selected).not.toBe('Microphone'); // a real device label
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('camera: a generic "Camera" entry asks for permission, then lists real devices and records', async ({ page }) => {
    await boot(page, noPermissionYet);
    const cam = page.getByRole('combobox', { name: 'Camera' });
    await expect.poll(() => cam.locator('option').allTextContents()).toEqual(['Off', 'Camera']);
    await expect(cam).toHaveValue('');
    expect(await page.evaluate(() => (window as any).__gum.length)).toBe(0);
    await cam.selectOption({ label: 'Camera' });
    const calls = await page.evaluate(() => (window as any).__gum);
    expect(calls).toHaveLength(1);
    expect(calls[0].video.deviceId).toBeUndefined(); // default device, no stale exact id
    await expect.poll(async () => (await cam.locator('option').allTextContents()).includes('Camera')).toBe(false);
    const labels = await cam.locator('option').allTextContents();
    expect(labels.length).toBeGreaterThan(1);
    expect(await cam.inputValue()).not.toBe('');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Start Recording' }).click();
    await expect(page.getByRole('button', { name: 'Stop Sharing' })).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Stop Sharing' }).click();
    await page.waitForFunction(() => (window as any).__FRAMECUT_LAST_CAPTURE__?.sources?.some((x: any) => x.id === 'camera' && x.size > 0), null, { timeout: 15000 });
  });

  test('records with narration after a first-time permission grant', async ({ page }) => {
    await boot(page, noPermissionYet);
    const mic = page.getByRole('combobox', { name: 'Microphone' });
    await mic.selectOption({ label: 'Microphone' });
    await expect(page.getByRole('meter', { name: 'Microphone level' })).toBeVisible();
    await page.getByRole('button', { name: 'Start Recording' }).click();
    await expect(page.getByRole('button', { name: 'Stop Sharing' })).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Stop Sharing' }).click();
    await page.waitForFunction(() => (window as any).__FRAMECUT_E2E__?.getSnapshot().narrationClips.length > 0, null, { timeout: 15000 });
  });
});

test.describe('QA warnings', () => {
  test('speed with a narration clip selected changes the recording; a no-op adds no undo step', async ({ page }) => {
    await boot(page);
    await loadNarrated(page, 0);
    let s = await E2E(page);
    await callApi(page, 'select', { type: 'narration', id: s.narrationClips[0].id });
    await callApi(page, 'setSelectedSpeed', 2);
    s = await E2E(page);
    expect(s.clips.find((c: any) => c.mediaType === 'main').speed).toBe(2);
    expect(s.narrationClips[0].speed).toBe(2);
    await callApi(page, 'setSelectedSpeed', 2); // nothing changes → no undo step
    await callApi(page, 'undo');
    s = await E2E(page);
    expect(s.clips.find((c: any) => c.mediaType === 'main').speed).toBe(1);
    expect(s.narrationClips[0].speed).toBe(1);
    await callApi(page, 'undo'); // back past the import
    expect((await E2E(page)).hasMainVideo).toBe(false);
  });

  test('failed import revokes every blob URL it created', async ({ page }) => {
    await boot(page, () => {
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      (window as any).__urls = { created: [] as string[], revoked: [] as string[] };
      URL.createObjectURL = (o: any) => { const u = create(o); (window as any).__urls.created.push(u); return u; };
      URL.revokeObjectURL = (u: string) => { (window as any).__urls.revoked.push(u); revoke(u); };
    });
    await page.evaluate(() => { (window as any).__urls.created = []; (window as any).__urls.revoked = []; (window as any).__FRAMECUT_E2E_FAIL_IMPORT__ = true; });
    await loadNarrated(page, 0, 1.0, false);
    const u = await page.evaluate(() => (window as any).__urls);
    expect(u.created.length).toBeGreaterThanOrEqual(2); // screen + narration
    for (const url of u.created) expect(u.revoked).toContain(url);
  });

  test('a failed recorder start also stops the microphone (device tracks and Web Audio graph)', async ({ page }) => {
    await boot(page, () => {
      const md = navigator.mediaDevices;
      const gum = md.getUserMedia.bind(md);
      (window as any).__micStreams = [];
      md.getUserMedia = async (c: any) => { const s = await gum(c); if (c?.audio) (window as any).__micStreams.push(s); return s; };
      const screens = new WeakSet<MediaStream>();
      const gdm = md.getDisplayMedia.bind(md);
      md.getDisplayMedia = async c => { const stream = await gdm(c); screens.add(stream); return stream; };
      const Orig = window.MediaRecorder;
      let fail = true;
      (window as any).MediaRecorder = class extends Orig {
        // Fail the screen recorder (the mic path also runs a throwaway encoder warm-up recorder).
        start(t?: number) { if (fail && screens.has(this.stream)) { fail = false; throw new DOMException('E2E: start failed', 'InvalidStateError'); } return super.start(t); }
      };
      const AC = window.AudioContext;
      (window as any).__contexts = [];
      (window as any).AudioContext = class extends AC { constructor(o?: any) { super(o); (window as any).__contexts.push(this); } };
    });
    const mic = page.getByRole('combobox', { name: 'Microphone' });
    await mic.selectOption(await mic.locator('option').nth(1).getAttribute('value') as string);
    await expect(page.getByRole('meter', { name: 'Microphone level' })).toBeVisible();
    await page.getByRole('button', { name: 'Start Recording' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__alerts.length)).toBe(1);
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({
      liveMicTracks: (window as any).__micStreams.flatMap((s: MediaStream) => s.getTracks()).filter((t: MediaStreamTrack) => t.readyState === 'live').length,
      openContexts: (window as any).__contexts.filter((c: AudioContext) => c.state !== 'closed').length,
    }));
    expect(r.liveMicTracks).toBe(0);
    expect(r.openContexts).toBe(0);
  });

  test('mid-recording mic disconnect stops the mic recorder tracks while the screen keeps recording', async ({ page }) => {
    await boot(page, () => {
      const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      (window as any).__micTracks = [];
      navigator.mediaDevices.getUserMedia = async (c: any) => { const s = await gum(c); if (c?.audio) (window as any).__micTracks.push(s.getAudioTracks()[0]); return s; };
      const Orig = window.MediaRecorder;
      (window as any).__recStreams = [];
      (window as any).MediaRecorder = class extends Orig { constructor(st: MediaStream, o?: any) { super(st, o); (window as any).__recStreams.push(st); } };
    });
    const mic = page.getByRole('combobox', { name: 'Microphone' });
    await mic.selectOption(await mic.locator('option').nth(1).getAttribute('value') as string);
    await expect(page.getByRole('meter', { name: 'Microphone level' })).toBeVisible();
    await page.getByRole('button', { name: 'Start Recording' }).click();
    await expect(page.getByRole('button', { name: 'Stop Sharing' })).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const t = (window as any).__micTracks.at(-1) as MediaStreamTrack; t.stop(); t.dispatchEvent(new Event('ended')); });
    await expect(page.getByTestId('recording-notice')).toContainText('Microphone disconnected');
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const ss = (window as any).__recStreams as MediaStream[];
      const audioOnly = ss.filter(s => s.getVideoTracks().length === 0);
      const video = ss.filter(s => s.getVideoTracks().length > 0);
      return {
        micLive: audioOnly.flatMap(s => s.getTracks()).filter(t => t.readyState === 'live').length,
        micCount: audioOnly.length,
        screenLive: video.flatMap(s => s.getVideoTracks()).filter(t => t.readyState === 'live').length,
      };
    });
    expect(r.micCount).toBeGreaterThan(0);
    expect(r.micLive).toBe(0);
    expect(r.screenLive).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Stop Sharing' }).click();
  });

  test("a previous session's mic 'ended' does not cut the next recording's narration", async ({ page }) => {
    await boot(page, () => {
      const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      (window as any).__micTracks = [];
      navigator.mediaDevices.getUserMedia = async (c: any) => { const s = await gum(c); if (c?.audio) (window as any).__micTracks.push(s.getAudioTracks()[0]); return s; };
    });
    const mic = page.getByRole('combobox', { name: 'Microphone' });
    await mic.selectOption(await mic.locator('option').nth(1).getAttribute('value') as string);
    await expect(page.getByRole('meter', { name: 'Microphone level' })).toBeVisible();
    const record = async (ms: number, during?: () => Promise<void>) => {
      await page.getByRole('button', { name: 'Start Recording' }).click();
      await expect(page.getByRole('button', { name: 'Stop Sharing' })).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(ms / 2);
      if (during) await during();
      await page.waitForTimeout(ms / 2);
      await page.getByRole('button', { name: 'Stop Sharing' }).click();
      await expect(page.getByRole('button', { name: 'Stop Sharing' })).toHaveCount(0, { timeout: 15000 });
    };
    await record(1500);
    await page.waitForFunction(() => (window as any).__FRAMECUT_LAST_CAPTURE__, null, { timeout: 15000 });
    const firstTracks = await page.evaluate(() => { const w = window as any; w.__firstCap = w.__FRAMECUT_LAST_CAPTURE__; w.__oldTracks = [...w.__micTracks]; return w.__oldTracks.length; });
    expect(firstTracks).toBeGreaterThan(0);
    await page.locator('[title="Remove"]').first().click();
    await expect(page.getByRole('button', { name: 'Start Recording' })).toBeVisible({ timeout: 5000 });
    if ((await mic.inputValue()) === '') {
      await mic.selectOption(await mic.locator('option').nth(1).getAttribute('value') as string);
      await expect(page.getByRole('meter', { name: 'Microphone level' })).toBeVisible();
    }
    await record(3000, async () => {
      await page.evaluate(() => { for (const t of (window as any).__oldTracks as MediaStreamTrack[]) t.dispatchEvent(new Event('ended')); });
    });
    await page.waitForFunction(() => (window as any).__FRAMECUT_LAST_CAPTURE__ !== (window as any).__firstCap, null, { timeout: 15000 });
    const cap = await page.evaluate(() => (window as any).__FRAMECUT_LAST_CAPTURE__);
    const screen = cap.sources.find((x: any) => x.id === 'screen');
    const micSrc = cap.sources.find((x: any) => x.id === 'mic');
    expect(micSrc).toBeTruthy();
    expect(Math.abs(micSrc.stopOffset - screen.stopOffset)).toBeLessThan(0.5);
    await expect(page.getByTestId('recording-notice')).toHaveCount(0);
  });

  test('a failed recorder start also stops the camera opened for that recording', async ({ page }) => {
    await boot(page, () => {
      const md = navigator.mediaDevices;
      const gum = md.getUserMedia.bind(md);
      (window as any).__camStreams = [];
      md.getUserMedia = async (c: any) => { const s = await gum(c); if (c?.video) (window as any).__camStreams.push(s); return s; };
      const Orig = window.MediaRecorder;
      let fail = true;
      (window as any).MediaRecorder = class extends Orig {
        start(t?: number) { if (fail) { fail = false; throw new DOMException('E2E: start failed', 'InvalidStateError'); } return super.start(t); }
      };
    });
    const cam = page.getByRole('combobox', { name: 'Camera' });
    await cam.selectOption(await cam.locator('option').nth(1).getAttribute('value') as string);
    await expect.poll(() => page.evaluate(() => (window as any).__camStreams.length)).toBe(1);
    await page.getByRole('button', { name: 'Start Recording' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__alerts.length)).toBe(1);
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const ss = ((window as any).__camStreams as MediaStream[]).slice(1); // opened by the recording
      return { opened: ss.length, live: ss.flatMap(s => s.getTracks()).filter(t => t.readyState === 'live').length };
    });
    expect(r.opened).toBeGreaterThan(0);
    expect(r.live).toBe(0);
  });

  test("a previous session's camera 'ended' does not cut the next recording's camera", async ({ page }) => {
    await boot(page, () => {
      const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      (window as any).__camTracks = [];
      navigator.mediaDevices.getUserMedia = async (c: any) => { const s = await gum(c); if (c?.video) (window as any).__camTracks.push(s.getVideoTracks()[0]); return s; };
    });
    const cam = page.getByRole('combobox', { name: 'Camera' });
    const pick = async () => { await cam.selectOption(await cam.locator('option').nth(1).getAttribute('value') as string); await expect(cam).not.toHaveValue(''); };
    await pick();
    const record = async (ms: number, during?: () => Promise<void>) => {
      await page.getByRole('button', { name: 'Start Recording' }).click();
      await expect(page.getByRole('button', { name: 'Stop Sharing' })).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(ms / 2);
      if (during) await during();
      await page.waitForTimeout(ms / 2);
      await page.getByRole('button', { name: 'Stop Sharing' }).click();
      await expect(page.getByRole('button', { name: 'Stop Sharing' })).toHaveCount(0, { timeout: 15000 });
    };
    await record(1500);
    await page.waitForFunction(() => (window as any).__FRAMECUT_LAST_CAPTURE__, null, { timeout: 15000 });
    await page.evaluate(() => { const w = window as any; w.__firstCap = w.__FRAMECUT_LAST_CAPTURE__; w.__oldTracks = [...w.__camTracks]; });
    await page.locator('[title="Remove"]').first().click();
    await expect(page.getByRole('button', { name: 'Start Recording' })).toBeVisible({ timeout: 5000 });
    if ((await cam.inputValue()) === '') await pick();
    await record(3000, async () => {
      await page.evaluate(() => { for (const t of (window as any).__oldTracks as MediaStreamTrack[]) t.dispatchEvent(new Event('ended')); });
    });
    await page.waitForFunction(() => (window as any).__FRAMECUT_LAST_CAPTURE__ !== (window as any).__firstCap, null, { timeout: 15000 });
    const cap = await page.evaluate(() => (window as any).__FRAMECUT_LAST_CAPTURE__);
    const screen = cap.sources.find((x: any) => x.id === 'screen');
    const camSrc = cap.sources.find((x: any) => x.id === 'camera');
    expect(camSrc).toBeTruthy();
    expect(cap.cameraEndedEarly).toBe(false);
    expect(Math.abs(camSrc.stopOffset - screen.stopOffset)).toBeLessThan(0.5);
  });
});
