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
  expect(new Set(gif.hashes).size).toBeGreaterThanOrEqual(80);
  expect(gif.hashes[0]).not.toBe(gif.hashes[50]);
  await expect(page.getByText('Exporting...')).toBeHidden();
});
