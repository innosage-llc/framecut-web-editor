import { test, expect, type TestInfo } from '@playwright/test';
import fs from 'fs';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { boot, callApi, loadWithCamera, applyLinkedEdits, noAacShim, exportGif, exportMp4, decodeGifFrames, SCREEN_FI, CAMERA_FI } from './helpers/cameraBubbleHelpers';

// #28 PR-C: the camera bubble stays within one frame of the screen across the whole MP4 export
// (play-along camera), and the GIF (exact per-frame seeks) is pixel-identical to the 9e9f0b2 baseline.
// Fixtures carry their frame index as 9 black/white blocks (scripts/make-frame-index-fixtures.py).

const BASELINE = 'tests/fixtures/camera-gif-baseline-9e9f0b2.json';
const W = 640, H = 360, FPS = 30;
// Screen bits: 40 px blocks at (20 + 44b, 20) in the 640x360 source. Camera bits: 3x3 grid of 40 px cells at (100, 60) in
// the 320x240 camera, cover-fit into the default bubble (108 px at 460.8, 234; scale 0.45, crop x 40).
// The screen sits in the default frame rect: origin (36.25, 20.25), scale 568/640 = 0.8875.
const SCREEN_BITS = Array.from({ length: 9 }, (_, b) => [36.25 + (40 + 44 * b) * 0.8875, 20.25 + 40 * 0.8875]);
const CAMERA_BITS = Array.from({ length: 9 }, (_, b) => { const r = Math.floor(b / 3), c = b % 3; return [460.8 + (120 + c * 40 - 40) * 0.45, 234 + (80 + r * 40) * 0.45]; });

test.beforeEach(async ({ page }, testInfo) => { await page.addInitScript(noAacShim); });

async function project(page: any) {
  await boot(page);
  await loadWithCamera(page, 0, 10, SCREEN_FI, CAMERA_FI);
  const clips = await applyLinkedEdits(page);
  await page.waitForTimeout(500);
  return clips;
}

const readBits = (frame: Buffer, pts: number[][]) => pts.reduce((acc, [x, y], b) => {
  const o = (Math.round(y) * W + Math.round(x)) * 3;
  const lum = (frame[o] + frame[o + 1] + frame[o + 2]) / 3;
  return acc | (lum > 128 ? 1 << b : 0);
}, 0);

async function checkMp4(page: any, testInfo: TestInfo, variant: { noWebCodecs?: boolean; noCamera?: boolean }) {
  if (variant.noWebCodecs) await page.addInitScript(() => { delete (window as any).VideoDecoder; });
  const clips = await project(page);
  if (variant.noCamera) {
    for (const c of clips) await callApi(page, 'updateClip', c.id, { cameraBubble: { ...c.cameraBubble, visible: false } });
    await page.waitForTimeout(300);
  }
  const tag = (variant.noWebCodecs ? 'noWC' : 'wc') + (variant.noCamera ? '-nocam' : '');
  const { path, seconds } = await exportMp4(page);
  fs.copyFileSync(path, testInfo.outputPath(`prc-sync-export-${tag}.mp4`));
  const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path]).toString().trim().split(',').map(Number);
  expect([w, h]).toEqual([W, H]);
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 30 });
  const n = raw.length / (W * H * 3);
  const sorted = [...clips].sort((a: any, b: any) => a.offset - b.offset);
  const speedAt = (t: number) => (sorted.find((c: any) => t >= c.offset && t < c.offset + (c.sourceEnd - c.sourceStart) / c.speed)?.speed ?? 1);
  const rows: { i: number; screen: number; camera: number; offsetFrames: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / FPS;
    if (t >= sorted.reduce((m: number, c: any) => Math.max(m, c.offset + (c.sourceEnd - c.sourceStart) / c.speed), 0) - 1 / FPS) break;
    const f = raw.subarray(i * W * H * 3, (i + 1) * W * H * 3);
    const screen = readBits(f, SCREEN_BITS), camera = readBits(f, CAMERA_BITS);
    // Offset in output frames: one output frame spans `speed` source frames.
    rows.push({ i, screen, camera, offsetFrames: Math.abs(camera - screen) / speedAt(t) });
  }
  // The screen frame is the one the edited timeline asks for (±1 frame), not wherever playback got to.
  const expectedScreen = (t: number) => { const c = sorted.find((c: any) => t >= c.offset && t < c.offset + (c.sourceEnd - c.sourceStart) / c.speed); return c ? Math.round((c.sourceStart + (t - c.offset) * c.speed) * FPS) : null; };
  const max = Math.max(...rows.map(r => r.offsetFrames));
  fs.writeFileSync(testInfo.outputPath(`prc-sync-offsets-${tag}.json`), JSON.stringify({ exportSeconds: seconds, frames: rows.length, maxOffsetFrames: max, rows }, null, 1));
  const maxScreenErr = Math.max(...rows.map(r => { const e = expectedScreen(r.i / FPS); return e === null ? 0 : Math.abs(r.screen - e); }));
  console.log('MP4_SYNC', tag, JSON.stringify({ exportSeconds: seconds, frames: rows.length, maxOffsetFrames: max, maxScreenErrFrames: maxScreenErr }));
  expect(rows.length).toBeGreaterThan(200);
  // Screen index sanity: it follows the edited timeline (split + 2x + trim), so the decode is real.
  expect(new Set(rows.map(r => r.screen)).size).toBeGreaterThan(150);
  for (const r of rows) { const e = expectedScreen(r.i / FPS); if (e !== null) expect(Math.abs(r.screen - e), `frame ${r.i}: screen ${r.screen} expected ${e}`).toBeLessThanOrEqual(1); }
  if (!variant.noCamera) for (const r of rows) expect(r.offsetFrames, `frame ${r.i}: screen ${r.screen} camera ${r.camera}`).toBeLessThanOrEqual(1);
}

test('MP4: camera within one frame of the screen for every frame, after split, speed and trim', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await checkMp4(page, testInfo, {});
});

test('MP4 without WebCodecs (fallback): screen and camera both frame-exact (QA #49 B1)', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await checkMp4(page, testInfo, { noWebCodecs: true });
});

test('MP4 without a camera bubble: screen frame-exact at split/speed/trim points (QA #49 W3)', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await checkMp4(page, testInfo, { noCamera: true });
});

test('GIF is pixel-identical to the 9e9f0b2 baseline (same project)', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await project(page);
  const { path, seconds } = await exportGif(page);
  const gif = await decodeGifFrames(page, fs.readFileSync(path));
  const hashes = gif.frames.map(f => crypto.createHash('sha256').update(Buffer.from(f, 'base64')).digest('hex'));
  const result = { exportSeconds: seconds, count: gif.count, w: gif.w, h: gif.h, hashes };
  if (process.env.CAPTURE_GIF_BASELINE) {
    fs.writeFileSync(BASELINE, JSON.stringify({ commit: '9e9f0b2', count: gif.count, w: gif.w, h: gif.h, hashes }, null, 1) + '\n');
    fs.copyFileSync(path, testInfo.outputPath('prc-gif-baseline-9e9f0b2.gif'));
  }
  fs.writeFileSync(testInfo.outputPath('prc-gif-current.json'), JSON.stringify(result, null, 1));
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  expect([gif.count, gif.w, gif.h]).toEqual([base.count, base.w, base.h]);
  const diff = hashes.map((h, i) => (h === base.hashes[i] ? -1 : i)).filter(i => i >= 0);
  expect(diff, `frames differing from baseline: ${diff.join(',')}`).toEqual([]);
});
