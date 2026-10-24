/**
 * GIF export regression: prod v0.2.1 downloaded a GIF whose frames were all identical.
 * Drives the real UI export and decodes every frame of the downloaded GIF.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { decodeGif, loadFixture, openGifSettings } from './helpers/gifExportHelpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'e2e-testsrc-10s.webm'); // 640x360, 10s

test('GIF export contains ~fps*duration mostly distinct frames at the export size (not preview size)', async ({ page }) => {
  test.setTimeout(180_000);
  await loadFixture(page, FIXTURE, 10);
  await openGifSettings(page);
  await page.getByLabel('GIF frame rate').selectOption('10');
  await page.getByLabel('GIF max longest side').selectOption('480');
  const download = page.waitForEvent('download', { timeout: 170_000 });
  await page.getByRole('button', { name: 'Export GIF' }).click();
  const gif = await decodeGif(page, fs.readFileSync((await (await download).path())!));

  expect(gif.count).toBe(100); // 10s @ 10fps
  expect([gif.w, gif.h]).toEqual([480, 270]);
  // The 10fps sample of the 30fps test pattern changes every frame: every GIF frame must be distinct
  // and no two consecutive frames may repeat (main: 1 distinct; free-running playback sync: ~10 repeats).
  const repeats = gif.hashes.filter((h, i) => i > 0 && h === gif.hashes[i - 1]).length;
  expect(repeats).toBe(0);
  expect(new Set(gif.hashes).size).toBe(100);
  expect(gif.hashes[0]).not.toBe(gif.hashes[50]);
  await expect(page.getByText('Exporting...')).toBeHidden();
});
