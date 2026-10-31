import { test, expect } from '@playwright/test';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { boot, callApi, E2E, loadWithCamera, noAacShim, exportMp4, SCREEN_FI, CAMERA_FI } from './helpers/cameraBubbleHelpers';

test('MP4 fallback keeps the screen advancing after the camera ends', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(noAacShim);
  await page.addInitScript(() => { delete (window as any).VideoDecoder; });
  await boot(page);
  // The screen lasts three seconds; the camera disconnects after one second.
  await loadWithCamera(page, 0, 1, SCREEN_FI, CAMERA_FI);
  const clip = (await E2E(page)).cameraBubbles[0];
  await callApi(page, 'updateClip', clip.id, { sourceEnd: 3 });
  const { path } = await exportMp4(page);
  fs.copyFileSync(path, testInfo.outputPath('camera-ends-early.mp4'));
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 128 << 20 });
  const width = 640, height = 360, frameBytes = width * height * 3;
  const count = raw.length / frameBytes;
  expect(count).toBeGreaterThanOrEqual(89);
  // Read the fixture's nine-bit source-frame index through the default background frame.
  for (let i = 0; i < Math.min(count, 89); i++) {
    let sourceFrame = 0;
    for (let bit = 0; bit < 9; bit++) {
      const x = Math.round(36.25 + (40 + 44 * bit) * 0.8875);
      const y = Math.round(20.25 + 40 * 0.8875);
      const offset = i * frameBytes + (y * width + x) * 3;
      const luminance = (raw[offset] + raw[offset + 1] + raw[offset + 2]) / 3;
      if (luminance > 128) sourceFrame |= 1 << bit;
    }
    expect(Math.abs(sourceFrame - i), `output frame ${i}: screen frame ${sourceFrame}`).toBeLessThanOrEqual(1);
  }
});
