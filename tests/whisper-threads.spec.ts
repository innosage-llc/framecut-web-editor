/**
 * Follow-up to #27: multi-threaded Whisper (ONNX Runtime WASM + SharedArrayBuffer) behind
 * cross-origin isolation (COOP same-origin + COEP credentialless), with a single-thread fallback.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chooseWhisperThreads, WHISPER_MAX_THREADS, LOW_MEMORY_MAX_THREADS } from '../utils/whisperThreads';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.describe('thread cap (pure)', () => {
  const iso = { isolated: true, sharedArrayBuffer: true };
  test('not isolated or no SharedArrayBuffer → exactly 1 thread', () => {
    expect(chooseWhisperThreads({ isolated: false, sharedArrayBuffer: true, hardwareConcurrency: 16, deviceMemory: 16 })).toBe(1);
    expect(chooseWhisperThreads({ isolated: true, sharedArrayBuffer: false, hardwareConcurrency: 16 })).toBe(1);
    expect(chooseWhisperThreads({ isolated: false, sharedArrayBuffer: false })).toBe(1);
  });
  test('cores - 1, at most 4; at most 2 on <= 4 GB devices; never below 1', () => {
    expect(WHISPER_MAX_THREADS).toBe(4);
    expect(LOW_MEMORY_MAX_THREADS).toBe(2);
    expect(chooseWhisperThreads({ ...iso, hardwareConcurrency: 16, deviceMemory: 8 })).toBe(4);
    expect(chooseWhisperThreads({ ...iso, hardwareConcurrency: 8 })).toBe(4);
    expect(chooseWhisperThreads({ ...iso, hardwareConcurrency: 4 })).toBe(3);
    expect(chooseWhisperThreads({ ...iso, hardwareConcurrency: 2 })).toBe(1);
    expect(chooseWhisperThreads({ ...iso, hardwareConcurrency: 1 })).toBe(1);
    expect(chooseWhisperThreads({ ...iso, hardwareConcurrency: 8, deviceMemory: 4 })).toBe(2);
    expect(chooseWhisperThreads({ ...iso, hardwareConcurrency: 8, deviceMemory: 2 })).toBe(2);
    expect(chooseWhisperThreads({ ...iso, hardwareConcurrency: 2, deviceMemory: 1 })).toBe(1);
    expect(chooseWhisperThreads({ ...iso, hardwareConcurrency: undefined })).toBe(1);
    expect(chooseWhisperThreads({ ...iso, hardwareConcurrency: NaN })).toBe(1);
  });
});

test('Cloudflare Pages _headers: COOP same-origin + COEP credentialless on every path', () => {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'public', '_headers'), 'utf8');
  const lines = raw.split(/\r?\n/);
  expect(lines[0]).toBe('/*');
  const headers = Object.fromEntries(lines.slice(1).filter(l => /^\s+\S/.test(l)).map(l => l.trim().split(/:\s*/, 2)));
  expect(headers).toEqual({ 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' });
});

test.describe('in the browser', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { (window as any).__FRAMECUT_E2E_ENABLED__ = true; });
  });

  test('isolated page: headers served, SharedArrayBuffer available, Tailwind + Inter still load', async ({ page }) => {
    const res = await page.goto('/');
    expect(res!.headers()['cross-origin-opener-policy']).toBe('same-origin');
    expect(res!.headers()['cross-origin-embedder-policy']).toBe('credentialless');
    await page.waitForFunction(() => !!(window as any).__FRAMECUT_E2E__);
    const env = await page.evaluate(async () => {
      const inter = await document.fonts.load('600 16px Inter').then(f => f.length).catch(() => -1);
      const el = document.querySelector('[class*="flex"]');
      return {
        isolated: crossOriginIsolated, sab: typeof SharedArrayBuffer !== 'undefined',
        threads: (window as any).__FRAMECUT_E2E__.whisperThreads(), cores: navigator.hardwareConcurrency,
        mem: (navigator as any).deviceMemory, display: el && getComputedStyle(el).display, inter,
      };
    });
    expect(env.isolated).toBe(true);
    expect(env.sab).toBe(true);
    expect(env.threads).toBe(chooseWhisperThreads({ isolated: true, sharedArrayBuffer: true, hardwareConcurrency: env.cores, deviceMemory: env.mem }));
    expect(env.display).toBe('flex'); // cdn.tailwindcss.com ran under COEP credentialless
    expect(env.inter).toBeGreaterThan(0); // fonts.gstatic.com Inter face loaded
  });

  test('fallback: without the headers the page is not isolated and Whisper uses 1 thread', async ({ page }) => {
    await page.route('**/*', async (route) => {
      if (route.request().resourceType() !== 'document') return route.continue();
      const r = await route.fetch();
      const h = { ...r.headers() };
      delete h['cross-origin-opener-policy']; delete h['cross-origin-embedder-policy'];
      await route.fulfill({ response: r, headers: h });
    });
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__FRAMECUT_E2E__);
    expect(await page.evaluate(() => [crossOriginIsolated, typeof SharedArrayBuffer, (window as any).__FRAMECUT_E2E__.whisperThreads()]))
      .toEqual([false, 'undefined', 1]);
    await expect(page.getByRole('button', { name: 'Generate subtitles' })).toHaveAttribute('data-available', 'true');
  });
});
