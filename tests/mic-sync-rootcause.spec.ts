import { test, expect } from '@playwright/test';

// #28 QA (mic-sync outlier): the three causes found, each pinned.

test('screen start event lag never moves the screen reference; a verified-flowing mic ignores its start event', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    // @ts-ignore
    const C = await import('/utils/captureClock.ts');
    return {
      // screen `start` 267 ms late under load (seen): not a late start
      slowScreenEvent: C.companionTimeOffset({ requestedOffset: 0, startOffset: 0.267, stopOffset: 5 }, { requestedOffset: 0, startOffset: 0.08, stopOffset: 5 }),
      // mic `start` 252 ms late in a cold renderer (seen), but the mono path was flowing
      verifiedMic: C.companionTimeOffset({ requestedOffset: 0, startOffset: 0.1, stopOffset: 5 }, { requestedOffset: 0, startOffset: 0.252, stopOffset: 5, flowingAtStart: true }),
      withLead: C.companionTimeOffset({ requestedOffset: 0, startOffset: 0.1, stopOffset: 5 }, { requestedOffset: 0, startOffset: 0.08, stopOffset: 5 }, 0.02),
    };
  });
  expect(r.slowScreenEvent).toBeCloseTo(0, 6);
  expect(r.verifiedMic).toBeCloseTo(0, 6);
  expect(r.withLead).toBeCloseTo(-0.02, 6);
});

test('a recorded screen file is re-based to its first audio packet (decoders and media elements agree)', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    // @ts-ignore
    const W = await import('/utils/webmAudioLead.ts');
    const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const rec = new MediaRecorder(s, { mimeType: 'video/webm;codecs=vp8,opus' });
    const ch: Blob[] = [];
    rec.ondataavailable = e => ch.push(e.data);
    rec.start();
    await new Promise(r => setTimeout(r, 1500));
    await new Promise(r => { rec.onstop = r; rec.stop(); });
    s.getTracks().forEach(t => t.stop());
    const blob = new Blob(ch, { type: 'video/webm' });
    const before = W.webmAudioLead(new Uint8Array(await blob.arrayBuffer()));
    const out = await W.rebaseWebmToAudioStart(blob);
    const after = W.webmAudioLead(new Uint8Array(await out.blob.arrayBuffer()));
    const v = document.createElement('video'); v.src = URL.createObjectURL(out.blob);
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = rej; });
    return { before, lead: out.lead, after, size: [blob.size, out.blob.size] };
  });
  expect(r.lead).toBeCloseTo(Math.max(0, r.before), 6);
  expect(r.after).toBeLessThanOrEqual(0);
  expect(r.size[0]).toBe(r.size[1]);
});
