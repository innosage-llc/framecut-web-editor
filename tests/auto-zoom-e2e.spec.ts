/**
 * In-tab Auto Zoom E2E (#22 / PR #35)
 *
 * CI cannot reliably complete a real getDisplayMedia screen capture, so this suite
 * injects the same click/cursor metadata shape useScreenRecorder would produce, loads
 * it through the app (opt-in __FRAMECUT_E2E__ seam), then drives Generate and asserts:
 *   1) zoom regions created from click metadata
 *   2) follow-cursor pan math on those regions
 *   3) soft pacing / click-triggered (not movement) behavior
 *
 * Remaining manual QA (preview): real tab capture → click around → Stop → visual ease.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE = path.join(__dirname, 'fixtures', 'e2e-black-60s.webm');

type E2EZoom = {
  id: string;
  start: number;
  end: number;
  auto: boolean;
  followCursor: boolean;
  width: number;
  height: number;
  x: number;
  y: number;
  cursorPathLen: number;
  cursorPath: { time: number; x: number; y: number }[];
};

type E2ESnapshot = {
  recordingEvents: { type: string; time: number; x?: number; y?: number }[];
  zoomEffects: E2EZoom[];
  autoZoomEnabled: boolean;
  duration: number;
  hasMainVideo: boolean;
};

declare global {
  interface Window {
    __FRAMECUT_E2E_ENABLED__?: boolean;
    __FRAMECUT_E2E__?: {
      getSnapshot: () => E2ESnapshot;
      loadWithEvents: (blob: Blob, events: any[], durationHint?: number) => Promise<void>;
      generateAutoZoom: () => void;
      removeAutoZooms: () => void;
    };
  }
}

/** Synthetic in-tab events: clustered clicks + moves (moves must NOT start zooms). */
function buildBusyUiEvents() {
  const events: any[] = [];
  // Cluster A ~ t=2–4 (nearby clicks → one longer region)
  events.push({ type: 'move', time: 1.5, x: 20, y: 25 });
  events.push({ type: 'click', time: 2.0, x: 20, y: 25 });
  events.push({ type: 'move', time: 2.4, x: 22, y: 28 });
  events.push({ type: 'click', time: 2.8, x: 24, y: 30 });
  events.push({ type: 'move', time: 3.5, x: 30, y: 35 });
  events.push({ type: 'click', time: 3.9, x: 32, y: 36 });

  // Cluster B ~ t=20
  events.push({ type: 'move', time: 19.0, x: 70, y: 40 });
  events.push({ type: 'click', time: 20.0, x: 72, y: 42 });
  events.push({ type: 'move', time: 20.5, x: 75, y: 45 });
  events.push({ type: 'click', time: 21.0, x: 78, y: 48 });

  // Cluster C ~ t=40
  events.push({ type: 'click', time: 40.0, x: 50, y: 70 });
  events.push({ type: 'move', time: 40.8, x: 55, y: 72 });
  events.push({ type: 'click', time: 41.2, x: 58, y: 74 });

  // Cluster D ~ t=55
  events.push({ type: 'click', time: 55.0, x: 15, y: 80 });
  events.push({ type: 'move', time: 55.5, x: 18, y: 82 });

  // Dense click train that MUST be soft-capped (busy UI demo ≠ one zoom per click)
  for (let i = 0; i < 10; i++) {
    events.push({ type: 'click', time: 8 + i * 0.35, x: 40 + i, y: 50 });
  }

  // Moves with NO clicks in a quiet span — must not create a zoom by themselves
  for (let i = 0; i < 20; i++) {
    events.push({ type: 'move', time: 48 + i * 0.1, x: 10 + i, y: 10 });
  }

  return events.sort((a, b) => a.time - b.time);
}

async function enableE2E(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    (window as any).__FRAMECUT_E2E_ENABLED__ = true;
  });
}

async function waitForE2E(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => !!(window as any).__FRAMECUT_E2E__);
}

async function loadFixtureWithEvents(
  page: import('@playwright/test').Page,
  events: any[],
  durationHint = 60
) {
  const b64 = fs.readFileSync(FIXTURE).toString('base64');
  await page.evaluate(
    async ({ b64, events, durationHint }) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'video/webm' });
      await window.__FRAMECUT_E2E__!.loadWithEvents(blob, events, durationHint);
    },
    { b64, events, durationHint }
  );
  await page.waitForFunction(() => {
    const s = (window as any).__FRAMECUT_E2E__?.getSnapshot?.();
    return s && s.hasMainVideo && s.duration > 0;
  }, null, { timeout: 20000 });
}

test.describe('Auto Zoom in-tab E2E', () => {
  test.beforeEach(async ({ page }) => {
    await enableE2E(page);
    await page.addInitScript(() => {
      try { localStorage.removeItem('framecut-project-v1'); } catch {}
    });
    await page.goto('/');
    await waitForE2E(page);
  });

  test('Generate from injected in-tab click metadata creates paced follow-cursor zooms', async ({ page }) => {
    const events = buildBusyUiEvents();
    // Disable auto-generate path first by loading with auto off via inject then Generate —
    // loadWithEvents respects autoZoomEnabled (default true). Remove autos then Generate via UI.
    await loadFixtureWithEvents(page, events, 60);

    // Wait for initial auto-generate (default ON) OR empty if race; then force Generate via toolbar.
    await page.waitForTimeout(500);

    // Remove any auto regions so Generate is the path under test
    const removeBtn = page.getByRole('button', { name: 'Remove Auto Zooms' });
    if (await removeBtn.isEnabled()) {
      await removeBtn.click();
      await page.waitForTimeout(200);
    }

    let snap = await page.evaluate(() => window.__FRAMECUT_E2E__!.getSnapshot());
    expect(snap.recordingEvents.some(e => e.type === 'click')).toBe(true);
    expect(snap.zoomEffects.filter(z => z.auto).length).toBe(0);

    // UI: Generate / regenerate Auto Zoom
    const generate = page.getByRole('button', { name: 'Generate Auto Zoom' });
    await expect(generate).toBeEnabled();
    await generate.click();

    await expect(page.getByText(/Auto Zoom:\s*\d+\s*zoom region/i)).toBeVisible({ timeout: 5000 });

    snap = await page.evaluate(() => window.__FRAMECUT_E2E__!.getSnapshot());
    const autos = snap.zoomEffects.filter(z => z.auto);
    expect(autos.length).toBeGreaterThanOrEqual(1);

    // Soft pacing: ≤ ~8 / min on a 60s timeline (cap 7 with defaults; allow 8)
    const perMin = autos.length / Math.max(snap.duration / 60, 1e-6);
    expect(autos.length).toBeLessThanOrEqual(8);
    expect(perMin).toBeLessThanOrEqual(8.5);

    // Click-triggered: every auto region should cover at least one click time
    const clickTimes = snap.recordingEvents.filter(e => e.type === 'click').map(e => e.time);
    for (const z of autos) {
      const hit = clickTimes.some(t => t >= z.start - 0.6 && t <= z.end + 0.1);
      expect(hit, `zoom ${z.start}-${z.end} should cover a click`).toBe(true);
    }

    // Quiet move-only span ~48–50 must not be the sole reason for a zoom without a click
    const moveOnlyZooms = autos.filter(z => z.start >= 47.5 && z.end <= 52);
    expect(moveOnlyZooms.length).toBe(0);

    // Follow cursor Auto: regions with a path should default follow on
    const withPath = autos.filter(z => z.cursorPathLen > 1);
    expect(withPath.length).toBeGreaterThan(0);
    expect(withPath.every(z => z.followCursor)).toBe(true);

    // Follow pan + ease: zoom math pans with cursor and eases (not linear hold at t=0)
    const pan = await page.evaluate(async () => {
      const snap = window.__FRAMECUT_E2E__!.getSnapshot();
      const z = snap.zoomEffects.find(x => x.followCursor && x.cursorPathLen > 1)!;
      const cr = await import('/utils/canvasRenderer.ts');
      const mid = z.start + (z.end - z.start) * 0.5;
      const early = z.start + 0.05;
      const hold = cr.calculateZoomRect(z as any, mid);
      const easeIn = cr.calculateZoomRect(z as any, early);
      const path = z.cursorPath;
      const midPath = path.reduce((b, p) => (Math.abs(p.time - mid) < Math.abs(b.time - mid) ? p : b), path[0]);
      return {
        hold,
        easeIn,
        midPath,
        isTransitioningEarly: easeIn.isTransitioning,
        widthAtHold: hold.width,
        widthAtEaseIn: easeIn.width,
      };
    });

    // Ease-in: near region start, width should still be between 100 and final (transitioning)
    expect(pan.isTransitioningEarly).toBe(true);
    expect(pan.widthAtEaseIn).toBeGreaterThan(pan.widthAtHold);
    expect(pan.widthAtEaseIn).toBeLessThanOrEqual(100);

    // Hold: box is zoomed (not full frame)
    expect(pan.widthAtHold).toBeLessThan(100);
    expect(pan.widthAtHold).toBeGreaterThanOrEqual(33); // within ~1–3× intensity band

    // UI smoke: Follow cursor checkbox available on selected auto zoom
    const zoomBlock = page.locator('.group\\/track, [class*="emerald"]').locator('text=Zoom').first();
    // Click first zoom segment via evaluate selection is hard; use timeline Zoom label
    const zoomLabels = page.locator('span.truncate', { hasText: 'Zoom' });
    await expect(zoomLabels.first()).toBeVisible();
    await zoomLabels.first().click({ force: true });
    await expect(page.getByText('Follow cursor (Auto)')).toBeVisible({ timeout: 5000 });
    const follow = page.getByRole('checkbox', { name: /Follow cursor/i });
    await expect(follow).toBeChecked();
  });

  test('moves alone never create zooms; clicks do', async ({ page }) => {
    const moveOnly = Array.from({ length: 30 }, (_, i) => ({
      type: 'move', time: 1 + i * 0.5, x: 10 + i, y: 20,
    }));
    await loadFixtureWithEvents(page, moveOnly, 60);
    await page.waitForTimeout(400);
    let snap = await page.evaluate(() => window.__FRAMECUT_E2E__!.getSnapshot());
    // Auto-generate with no clicks → 0 zooms
    expect(snap.zoomEffects.length).toBe(0);

    // Generate button should stay disabled (no click metadata)
    await expect(page.getByRole('button', { name: 'Generate Auto Zoom' })).toBeDisabled();

    // Now inject clicks by reloading with click events
    const withClicks = [
      ...moveOnly,
      { type: 'click', time: 5, x: 40, y: 40 },
      { type: 'click', time: 25, x: 60, y: 60 },
    ];
    await loadFixtureWithEvents(page, withClicks, 60);
    await page.waitForTimeout(600);
    snap = await page.evaluate(() => window.__FRAMECUT_E2E__!.getSnapshot());
    expect(snap.zoomEffects.length).toBeGreaterThanOrEqual(1);
    expect(snap.zoomEffects.every(z => z.auto)).toBe(true);
  });

  test('mocked getDisplayMedia recording captures clicks then Generate works', async ({ page }) => {
    // Fresh page with display-media mock (still in-tab click listeners on window)
    await page.addInitScript(() => {
      (window as any).__FRAMECUT_E2E_ENABLED__ = true;
      const original = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext('2d')!;
        let frame = 0;
        const draw = () => {
          ctx.fillStyle = '#111827';
          ctx.fillRect(0, 0, 640, 360);
          ctx.fillStyle = '#34d399';
          ctx.fillRect(40 + (frame % 50), 40, 80, 40);
          frame++;
          requestAnimationFrame(draw);
        };
        draw();
        const stream = canvas.captureStream(15);
        // Optional silent audio if supported
        try {
          const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
          if (AC) {
            const ac = new AC();
            const dest = ac.createMediaStreamDestination();
            const track = dest.stream.getAudioTracks()[0];
            if (track) stream.addTrack(track);
          }
        } catch { /* ignore */ }
        return stream;
      };
      void original;
    });
    await page.goto('/');
    await waitForE2E(page);

    await page.getByRole('button', { name: 'Start Recording' }).click();
    await expect(page.getByRole('button', { name: 'Stop Sharing' })).toBeVisible({ timeout: 15000 });

    // Drive in-tab pointer events the recorder listens for on window
    const vp = page.viewportSize() || { width: 1280, height: 720 };
    for (const [x, y, wait] of [
      [vp.width * 0.2, vp.height * 0.3, 200],
      [vp.width * 0.25, vp.height * 0.35, 200],
      [vp.width * 0.7, vp.height * 0.6, 400],
      [vp.width * 0.72, vp.height * 0.62, 200],
    ] as const) {
      await page.mouse.move(x, y);
      await page.waitForTimeout(80);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(wait);
    }

    // Confirm events counter moved (RecordingBar)
    const eventsLabel = page.locator('text=/\\d+ Events/');
    await expect(eventsLabel).toBeVisible();
    const eventsText = await eventsLabel.textContent();
    const n = parseInt(eventsText || '0', 10);
    expect(n).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Stop Sharing' }).click();
    await page.waitForFunction(() => {
      const s = (window as any).__FRAMECUT_E2E__?.getSnapshot?.();
      return s && s.hasMainVideo;
    }, null, { timeout: 20000 });

    const snap = await page.evaluate(() => window.__FRAMECUT_E2E__!.getSnapshot());
    expect(snap.recordingEvents.some(e => e.type === 'click')).toBe(true);

    // Auto-generate on load and/or Generate repair
    if (snap.zoomEffects.length === 0) {
      await page.getByRole('button', { name: 'Generate Auto Zoom' }).click();
      await expect(page.getByText(/Auto Zoom:\s*\d+\s*zoom region/i)).toBeVisible({ timeout: 5000 });
    }
    const after = await page.evaluate(() => window.__FRAMECUT_E2E__!.getSnapshot());
    expect(after.zoomEffects.length).toBeGreaterThanOrEqual(1);
  });
});
