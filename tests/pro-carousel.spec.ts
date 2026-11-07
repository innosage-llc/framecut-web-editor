import { test, expect } from '@playwright/test';

test('feature carousel rotates, wraps, and pauses during interaction and reduced motion', async ({ page }) => {
  await page.route('**/api/licensing/**', route => route.fulfill({ json: { authenticated: false, pro: false } }));
  await page.clock.install();
  await page.goto('/?framecut_checkout=success');
  const carousel = page.getByRole('region', { name: 'FrameCut Pro feature carousel' });
  const image = carousel.getByRole('img');
  await expect(image).toHaveAttribute('src', '/pro-features/app-store-01.png');
  await expect(carousel).not.toContainText(/\d\s*\/\s*5/);
  await page.clock.fastForward(6000);
  await expect(image).toHaveAttribute('src', '/pro-features/app-store-02.png');
  await carousel.hover();
  await page.clock.fastForward(12000);
  await expect(image).toHaveAttribute('src', '/pro-features/app-store-02.png');
  await page.mouse.move(0, 0);
  for (const id of ['03', '04', '05', '01']) {
    await page.clock.fastForward(6000);
    await expect(image).toHaveAttribute('src', `/pro-features/app-store-${id}.png`);
  }
  await carousel.getByRole('button', { name: 'Next feature', exact: true }).click();
  await page.mouse.move(0, 0);
  await page.clock.fastForward(12000);
  await expect(image).toHaveAttribute('src', '/pro-features/app-store-02.png');
  await page.getByLabel('Purchase email').focus();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.fastForward(12000);
  await expect(image).toHaveAttribute('src', '/pro-features/app-store-02.png');
});
