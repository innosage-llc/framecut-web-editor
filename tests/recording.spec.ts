import { test, expect } from '@playwright/test';

test('capture a screen recording for 5 seconds', async ({ page }) => {
    await page.goto('/');

    // 1. Verify we are on the initial landing state
    await expect(page.getByRole('button', { name: 'Start Screen Recording' })).toBeVisible();

    // 2. Click Start Recording
    await page.getByRole('button', { name: 'Start Screen Recording' }).click();

    // 3. Wait for recording to start (look for Stop button or recording indicator)
    await expect(page.getByRole('button', { name: 'Stop Recording' })).toBeVisible({ timeout: 10000 });

    // 4. Wait for 5 seconds
    console.log('Recording for 5 seconds...');
    await page.waitForTimeout(5000);

    // 5. Click Stop Recording
    await page.getByRole('button', { name: 'Stop Recording' }).click();

    // 6. Verify transition to Editor
    // Give it a bit more time and look for the filename or the canvas
    try {
        await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
        await expect(page.locator('text=Recording')).toBeVisible({ timeout: 5000 });
    } catch (e) {
        await page.screenshot({ path: 'test-failure.png' });
        throw e;
    }
});
