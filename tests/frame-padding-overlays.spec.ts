/**
 * Issue #26 P1 — with Background Frame padding on, Spotlight / Blur / Subtitle edit
 * overlays and pointer mapping use the padded content rect (getFrameContentRect).
 *
 * Uses the existing opt-in __FRAMECUT_E2E__ seam plus the real Upload Video file input.
 * Does not require a visual browser; documents any manual checklist gaps in comments.
 */
import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE = path.join(__dirname, 'fixtures', 'e2e-black-60s.webm');

async function enableE2E(page: Page) {
  await page.addInitScript(() => {
    (window as any).__FRAMECUT_E2E_ENABLED__ = true;
    try { localStorage.removeItem('framecut-project-v1'); } catch {}
  });
}

async function waitForE2E(page: Page) {
  await page.waitForFunction(() => !!(window as any).__FRAMECUT_E2E__);
}

async function loadFixtureAsImport(page: Page, durationHint = 60) {
  // Empty events = Cap-parity imported MP4 (no click metadata).
  const b64 = fs.readFileSync(FIXTURE).toString('base64');
  await page.evaluate(
    async ({ b64, durationHint }) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'video/webm' });
      await (window as any).__FRAMECUT_E2E__.loadWithEvents(blob, [], durationHint);
    },
    { b64, durationHint }
  );
  await page.waitForFunction(() => {
    const s = (window as any).__FRAMECUT_E2E__?.getSnapshot?.();
    return s && s.hasMainVideo && s.duration > 0;
  }, null, { timeout: 20000 });
}

async function uploadFixtureViaFileInput(page: Page) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Upload Video' }).click(),
  ]);
  await chooser.setFiles(FIXTURE);
  await expect(page.locator('canvas:not(.hidden)').first()).toBeVisible({ timeout: 20000 });
}

test.describe('Frame padding overlay mapping (#26 P1)', () => {
  test.beforeEach(async ({ page }) => {
    await enableE2E(page);
    await page.goto('/');
    await waitForE2E(page);
    await loadFixtureAsImport(page, 60);
  });

  async function expectedFrameBox(page: Page) {
    return page.evaluate(async () => {
      const m = await import('/utils/backgroundFrame.ts');
      const canvas = document.querySelector('canvas.w-full') as HTMLCanvasElement;
      const content = canvas.parentElement as HTMLElement;
      const b = content.getBoundingClientRect();
      const r = m.getFrameContentRect(b.width, b.height, m.DEFAULT_BACKGROUND_FRAME);
      return { active: m.isFrameActive(m.DEFAULT_BACKGROUND_FRAME), x: b.left + r.x, y: b.top + r.y, width: r.width, height: r.height };
    });
  }

  test('spotlight handles sit inside the padded content rect', async ({ page }) => {
    await page.getByTitle('Add Spotlight Effect').click();
    const box = page.locator('[data-testid="effect-overlay-layer"] .border-amber-400').first();
    await expect(box).toBeVisible();
    const exp = await expectedFrameBox(page);
    expect(exp.active).toBe(true);
    const layer = (await page.getByTestId('effect-overlay-layer').boundingBox())!;
    expect(Math.abs(layer.x - exp.x)).toBeLessThan(2);
    expect(Math.abs(layer.y - exp.y)).toBeLessThan(2);
    expect(Math.abs(layer.width - exp.width)).toBeLessThan(2);
    expect(Math.abs(layer.height - exp.height)).toBeLessThan(2);

    const spot = (await box.boundingBox())!;
    const snap = await page.evaluate(() => (window as any).__FRAMECUT_E2E__.getSnapshot());
    const s = snap.spotlightEffects?.[0] ?? { x: 40, y: 40, width: 20, height: 20 };
    expect(Math.abs(spot.x - (layer.x + (s.x / 100) * layer.width))).toBeLessThan(2);
    expect(Math.abs(spot.y - (layer.y + (s.y / 100) * layer.height))).toBeLessThan(2);
    expect(Math.abs(spot.width - (s.width / 100) * layer.width)).toBeLessThan(2);
  });

  test('dragging spotlight maps pointer delta through the padded rect', async ({ page }) => {
    await page.getByTitle('Add Spotlight Effect').click();
    const box = page.locator('[data-testid="effect-overlay-layer"] .border-amber-400').first();
    await expect(box).toBeVisible();
    const layer = (await page.getByTestId('effect-overlay-layer').boundingBox())!;
    const b = (await box.boundingBox())!;
    const before = (await page.evaluate(() => (window as any).__FRAMECUT_E2E__.getSnapshot())).spotlightEffects[0];
    const dx = layer.width * 0.1;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + dx / 2, b.y + b.height / 2, { steps: 3 });
    await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2, { steps: 3 });
    await page.mouse.up();
    const after = (await page.evaluate(() => (window as any).__FRAMECUT_E2E__.getSnapshot())).spotlightEffects[0];
    expect(Math.abs((after.x - before.x) - 10)).toBeLessThan(1);
  });

  test('blur box overlay is mapped into the padded rect', async ({ page }) => {
    await page.getByTitle('Add Blur Effect').click();
    await expect(page.locator('[data-testid="effect-overlay-layer"] .border-pink-400').first()).toBeVisible();
  });

  test('subtitle overlay is mapped into the padded rect', async ({ page }) => {
    await page.getByTitle('Add Subtitle').click();
    await expect(page.locator('[data-testid="effect-overlay-layer"] .ring-purple-500').first()).toBeVisible();
  });
});
