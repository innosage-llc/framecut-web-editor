import { test, expect } from '@playwright/test';

test('capture a screen recording for 5 seconds', async ({ page }) => {
    // Opt-in E2E seam (App.tsx) so we can assert the recording really loaded.
    await page.addInitScript(() => {
        (window as any).__FRAMECUT_E2E_ENABLED__ = true;
        try { localStorage.removeItem('framecut-project-v1'); } catch {}
    });
    await page.goto('/');

    // 1. Verify we are on the initial landing state
    await expect(page.getByRole('button', { name: 'Start Recording' })).toBeVisible();

    // 2. Click Start Recording
    await page.getByRole('button', { name: 'Start Recording' }).click();

    // 3. Wait for recording to start (look for Stop button or recording indicator)
    await expect(page.getByRole('button', { name: 'Stop Sharing' })).toBeVisible({ timeout: 10000 });

    // 4. Wait for 5 seconds
    console.log('Recording for 5 seconds...');
    await page.waitForTimeout(5000);

    // 5. Click Stop Recording
    await page.getByRole('button', { name: 'Stop Sharing' }).click();

    // 6. Verify transition to Editor
    // Give it a bit more time and look for the filename or the canvas
    try {
        await expect(page.locator('canvas:not(.hidden)').first()).toBeVisible({ timeout: 15000 });
        await expect(page.locator('text=Recording')).toBeVisible({ timeout: 5000 });
        // Editor-only state: the landing empty state (Start Recording) is gone,
        // a clip named "Screen Recording <time>" exists, and a ~5s main video is loaded.
        await expect(page.getByRole('button', { name: 'Start Recording' })).toBeHidden();
        await expect(page.getByText(/^Screen Recording \d/).first()).toBeVisible();
        const snap = await page.evaluate(() => (window as any).__FRAMECUT_E2E__.getSnapshot());
        expect(snap.hasMainVideo).toBe(true);
        expect(snap.duration).toBeGreaterThanOrEqual(4);
    } catch (e) {
        await page.screenshot({ path: 'test-failure.png' });
        throw e;
    }
});
