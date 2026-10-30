import { test, expect } from '@playwright/test';
import fs from 'fs';
import { PINK, CYAN, YELLOW, SCREEN, settle, E2E, callApi, near, boot, loadWithCamera, bubbleCentre, sample, previewPixel } from './helpers/cameraBubbleHelpers';

test.describe('camera bubble geometry (unit)', () => {
  test('defaults, clamping, 4:3 non-circle shapes, media time window', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async () => {
      // @ts-ignore
      const B = await import('/utils/cameraBubble.ts');
      return {
        def: B.DEFAULT_CAMERA_BUBBLE,
        circle: B.bubbleRect(B.DEFAULT_CAMERA_BUBBLE, 1920, 1080),
        rect: B.bubbleRect({ ...B.DEFAULT_CAMERA_BUBBLE, shape: 'rect' }, 1920, 1080),
        clampedPos: B.bubbleRect({ ...B.DEFAULT_CAMERA_BUBBLE, x: 0.99, y: 0.99 }, 1920, 1080),
        norm: B.normalizeBubble({ size: 5, borderWidth: 1, x: -3, shape: 'hex' as any }),
        normLow: B.normalizeBubble({ size: 0, borderWidth: -1 }),
        t: [B.cameraMediaTime(0.2, 0.5, 6), B.cameraMediaTime(1.5, 0.5, 6), B.cameraMediaTime(6.6, 0.5, 6)],
        res: [B.cameraResolutionFor(8), B.cameraResolutionFor(4), B.cameraResolutionFor(undefined)],
      };
    });
    expect(r.def).toEqual({ visible: true, x: 0.72, y: 0.65, size: 0.3, shape: 'circle', borderWidth: 0.004, borderColor: '#ffffff' });
    expect(r.circle.width).toBeCloseTo(324, 6); expect(r.circle.height).toBeCloseTo(324, 6);
    expect(r.circle.x).toBeCloseTo(0.72 * 1920, 6); expect(r.circle.y).toBeCloseTo(0.65 * 1080, 6);
    expect(r.rect.height / r.rect.width).toBeCloseTo(0.75, 6);
    expect(r.clampedPos.x + r.clampedPos.width).toBeCloseTo(1920, 6);
    expect(r.clampedPos.y + r.clampedPos.height).toBeCloseTo(1080, 6);
    expect(r.norm).toMatchObject({ size: 0.8, borderWidth: 0.03, x: 0, shape: 'circle' });
    expect(r.normLow).toMatchObject({ size: 0.1, borderWidth: 0 });
    expect(r.t[0]).toBeNull(); expect(r.t[1]).toBeCloseTo(1, 6); expect(r.t[2]).toBeNull();
    expect(r.res).toEqual([{ width: 1280, height: 720 }, { width: 640, height: 480 }, { width: 1280, height: 720 }]);
  });
});

test.describe('camera bubble in the editor', () => {
  test('import: one undo step, default bubble on the screen clip, drawn in preview and export frames', async ({ page }) => {
    await boot(page);
    await loadWithCamera(page, 0.5);
    let s = await E2E(page);
    expect(s.camera).toMatchObject({ timeOffset: 0.5, duration: 6, stored: true });
    const main = s.cameraBubbles.find((c: any) => c.cameraBubble);
    expect(main.cameraBubble).toEqual({ visible: true, x: 0.72, y: 0.65, size: 0.3, shape: 'circle', borderWidth: 0.004, borderColor: '#ffffff' });
    expect(main.recordingLinkID).toBeTruthy();
    const centre = await bubbleCentre(page, main.cameraBubble);

    // Export path: source 1.5 → camera 1.0 (pink); source 3.0 → camera 2.5 (cyan).
    expect(near((await sample(page, 1.5, [centre]))[0], PINK)).toBe(true);
    expect(near((await sample(page, 3.0, [centre]))[0], CYAN)).toBe(true);
    // Before the camera starts (source 0.2 < offset 0.5) there is no bubble.
    expect(near((await sample(page, 0.2, [centre]))[0], PINK)).toBe(false);

    // Preview path.
    await callApi(page, 'seek', 1.5);
    await expect.poll(async () => near(await previewPixel(page, centre), PINK), { timeout: 5000 }).toBe(true);

    // Undo removes the whole import in one step.
    await callApi(page, 'undo');
    s = await E2E(page);
    expect(s.camera).toBeNull();
    expect(s.hasMainVideo).toBe(false);
  });

  test('draw order: bubble above the background frame, subtitles above the bubble', async ({ page }) => {
    await boot(page);
    await loadWithCamera(page, 0);
    const s = await E2E(page);
    const centre = await bubbleCentre(page, s.cameraBubbles[0].cameraBubble);
    await callApi(page, 'setBackgroundFrame', { enabled: true, padding: 0.1, wallpaper: { kind: 'color' } });
    expect(near((await sample(page, 1.0, [centre]))[0], PINK)).toBe(true);
    // A subtitle with an opaque background exactly over the bubble centre wins.
    await page.getByTitle('Add Subtitle').click();
    await settle(page);
    const sub = (await E2E(page)).subtitles[0];
    // Subtitles are positioned in the padded content rect; map the canvas point into it.
    const pad = await page.evaluate(async () => {
      // @ts-ignore
      const F = await import('/utils/backgroundFrame.ts');
      const st = (window as any).__FRAMECUT_E2E__.getSnapshot().backgroundFrame;
      return F.getFrameContentRect(640, 360, st);
    });
    const cx = (centre[0] / 100 * 640 - pad.x) / pad.width * 100;
    const cy = (centre[1] / 100 * 360 - pad.y) / pad.height * 100;
    await callApi(page, 'updateSubtitle', sub.id, { start: 0, end: 10, x: cx, y: cy, text: '██████', color: '#00ff00', backgroundColor: '#00ff00', scale: 2 });
    expect(near((await sample(page, 1.0, [centre]))[0], [0, 255, 0])).toBe(true);
  });

  test('linked edits carry the camera: trim, split, speed, move', async ({ page }) => {
    await boot(page);
    await loadWithCamera(page, 0.5);
    let s = await E2E(page);
    const id = s.cameraBubbles[0].id;
    const centre = await bubbleCentre(page, s.cameraBubbles[0].cameraBubble);
    // Trim the head: timeline 0.2 now shows source 3.2 → camera 2.7 (cyan).
    await callApi(page, 'updateClip', id, { sourceStart: 3 });
    expect(near((await sample(page, 0.2, [centre]))[0], CYAN)).toBe(true);
    await callApi(page, 'undo');
    // Speed 2×: timeline 2.5 → source 5.0 → camera 4.5 (yellow).
    await callApi(page, 'select', { type: 'clip', id });
    await callApi(page, 'setSelectedSpeed', 2);
    expect(near((await sample(page, 2.5, [centre]))[0], YELLOW)).toBe(true);
    await callApi(page, 'undo');
    // Move the clip right by 2 s: timeline 3.5 → source 1.5 → camera 1.0 (pink).
    await callApi(page, 'updateClip', id, { offset: 2 });
    expect(near((await sample(page, 3.5, [centre]))[0], PINK)).toBe(true);
    await callApi(page, 'undo');
    // Split at 3 s: both halves keep the bubble, and the right half still maps source→camera.
    await callApi(page, 'select', { type: 'clip', id });
    await callApi(page, 'seek', 3);
    await callApi(page, 'split');
    s = await E2E(page);
    const mains = s.cameraBubbles.filter((c: any) => c.cameraBubble);
    expect(mains).toHaveLength(2);
    expect(near((await sample(page, 3.2, [centre]))[0], CYAN)).toBe(true);
    // Delete the left half: the right half ripples to 0 and carries its camera time.
    const left = mains.find((c: any) => c.sourceStart === 0);
    await callApi(page, 'select', { type: 'clip', id: left.id });
    await callApi(page, 'deleteSelected');
    s = await E2E(page);
    const right = s.cameraBubbles.find((c: any) => c.cameraBubble);
    const t = right.offset + 0.2; // source 3.2 → camera 2.7
    expect(near((await sample(page, t, [centre]))[0], CYAN)).toBe(true);
  });

  test('camera ends at its last frame; the bubble disappears after it (disconnect)', async ({ page }) => {
    await boot(page);
    // Camera disconnected 4.5 s into its media (recorded duration 4.5 s, file is 6 s).
    await loadWithCamera(page, 0.5, 4.5);
    const s = await E2E(page);
    const centre = await bubbleCentre(page, s.cameraBubbles[0].cameraBubble);
    expect(near((await sample(page, 4.9, [centre]))[0], YELLOW)).toBe(true);  // camera 4.4
    const after = (await sample(page, 6.0, [centre]))[0];                     // camera 5.5 > 4.5
    expect(near(after, YELLOW)).toBe(false);
    // Bubble hidden gives the same pixel as "after the camera ended".
    await callApi(page, 'updateCameraBubble', s.cameraBubbles[0].id, { visible: false });
    expect((await sample(page, 6.0, [centre]))[0]).toEqual(after);
  });

  test('inspector + canvas drag/resize are undoable and persisted', async ({ page }) => {
    await boot(page);
    await loadWithCamera(page, 0);
    let s = await E2E(page);
    const id = s.cameraBubbles[0].id;
    await callApi(page, 'select', { type: 'clip', id });
    await callApi(page, 'seek', 1);
    const controls = page.getByTestId('camera-bubble-controls');
    await expect(controls).toBeVisible();
    await controls.getByLabel('Camera shape Rounded').click();
    await controls.getByLabel('Camera bubble visible').click();
    s = await E2E(page);
    expect(s.cameraBubbles[0].cameraBubble).toMatchObject({ shape: 'rounded', visible: false });
    await callApi(page, 'undo');
    expect((await E2E(page)).cameraBubbles[0].cameraBubble).toMatchObject({ shape: 'rounded', visible: true });
    await callApi(page, 'undo');
    expect((await E2E(page)).cameraBubbles[0].cameraBubble.shape).toBe('circle');

    // Drag the bubble on the canvas: one undo step for the whole drag; position clamps on-canvas.
    const handle = page.getByTestId('camera-bubble-handle');
    await expect(handle).toBeVisible();
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) await page.mouse.move(box.x + box.width / 2 - i * 60, box.y + box.height / 2 - i * 40);
    await page.mouse.move(box.x - 5000, box.y - 5000);
    await page.mouse.up();
    s = await E2E(page);
    expect(s.cameraBubbles[0].cameraBubble.x).toBeCloseTo(0, 6);
    expect(s.cameraBubbles[0].cameraBubble.y).toBeCloseTo(0, 6);
    // Resize from the corner handle: grows, capped at 0.8.
    const rh = (await page.getByTestId('camera-bubble-resize').boundingBox())!;
    await page.mouse.move(rh.x + rh.width / 2, rh.y + rh.height / 2);
    await page.mouse.down();
    await page.mouse.move(rh.x + 100, rh.y + 100);
    await page.mouse.move(rh.x + 3000, rh.y + 3000);
    await page.mouse.up();
    s = await E2E(page);
    expect(s.cameraBubbles[0].cameraBubble.size).toBeCloseTo(0.8, 6);
    // Export frame shows the bubble at its new place (top-left corner region is pink).
    const c = await bubbleCentre(page, s.cameraBubbles[0].cameraBubble);
    expect(near((await sample(page, 1.0, [c]))[0], PINK)).toBe(true);
    await callApi(page, 'undo');
    expect((await E2E(page)).cameraBubbles[0].cameraBubble.size).toBeCloseTo(0.3, 6);
    await callApi(page, 'undo');
    expect((await E2E(page)).cameraBubbles[0].cameraBubble).toMatchObject({ x: 0.72, y: 0.65 });

    // Persisted: save, reload, the camera asset and the bubble come back.
    await callApi(page, 'updateCameraBubble', id, { size: 0.42 });
    await page.getByTitle('Save Project (Browser Storage)').click();
    await page.waitForFunction(() => !!localStorage.getItem('framecut-project-v1'));
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('framecut-project-v1')!));
    expect(saved.camera?.storageId).toBeTruthy();
    expect(saved.clips[0].cameraBubble).toMatchObject({ size: 0.42 });
    expect(saved.clips[0].cameraBubble).not.toHaveProperty('mirrored');
  });
});

test.describe('camera recording (fake device)', () => {
  test('setup: camera Off by default, permission only when picked, live preview; recording yields a camera asset', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'fake camera is Chromium-only');
    await context.grantPermissions(['camera', 'microphone']);
    await page.addInitScript(() => {
      (window as any).__gumCalls = [];
      const md = navigator.mediaDevices;
      const orig = md.getUserMedia.bind(md);
      md.getUserMedia = (c: any) => { (window as any).__gumCalls.push(JSON.parse(JSON.stringify(c))); return orig(c); };
      // Screen picker: capture a canvas instead of the display.
      md.getDisplayMedia = async () => {
        const cv = document.createElement('canvas'); cv.width = 640; cv.height = 360;
        const ctx = cv.getContext('2d')!;
        const draw = () => { ctx.fillStyle = '#123456'; ctx.fillRect(0, 0, 640, 360); ctx.fillStyle = '#fff'; ctx.fillText(String(performance.now()), 10, 20); requestAnimationFrame(draw); };
        draw();
        return cv.captureStream(30);
      };
    });
    await boot(page);
    const setup = page.getByTestId('recording-setup');
    const camSel = setup.getByLabel('Camera');
    await expect(camSel).toHaveValue('');
    expect(await page.evaluate(() => (window as any).__gumCalls.length)).toBe(0);
    const value = await camSel.locator('option').nth(1).getAttribute('value');
    await camSel.selectOption(value!);
    await expect(setup.getByLabel('Camera preview')).toBeVisible();
    await expect.poll(() => page.evaluate(() => (document.querySelector('[aria-label="Camera preview"]') as HTMLVideoElement)?.videoWidth || 0)).toBeGreaterThan(0);
    const calls = await page.evaluate(() => (window as any).__gumCalls);
    expect(calls[0].video).toMatchObject({ width: { ideal: 1280 }, height: { ideal: 720 } });

    await page.getByRole('button', { name: 'Start Recording' }).click();
    await expect(page.getByRole('button', { name: 'Stop Sharing' })).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: 'Stop Sharing' }).click();
    await page.waitForFunction(() => !!(window as any).__FRAMECUT_E2E__?.getSnapshot().camera, null, { timeout: 20_000 });
    const cap = await page.evaluate(() => (window as any).__FRAMECUT_LAST_CAPTURE__);
    fs.writeFileSync('/workspace/pr28-logs/prc-fake-capture.json', JSON.stringify(cap, null, 2));
    expect(cap.sources.map((x: any) => x.id).sort()).toEqual(['camera', 'screen']);
    expect(cap.cameraSettings.width).toBeGreaterThan(0);
    const s = await E2E(page);
    expect(s.cameraBubbles[0].cameraBubble).toMatchObject({ visible: true, shape: 'circle' });
    expect(s.camera.duration).toBeGreaterThan(1);
  });
});
