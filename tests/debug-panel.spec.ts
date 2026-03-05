import { test, expect } from '@playwright/test';

test.describe('Performance Debug Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should toggle debug panel via toolbar button', async ({ page }) => {
    // Initially hidden
    await expect(page.locator('text=Performance Diagnostic')).not.toBeVisible();

    // Click toggle button (Activity icon)
    await page.getByTitle('Toggle Performance Debug (D)').click();
    await expect(page.locator('text=Performance Diagnostic')).toBeVisible();

    // Toggle off
    await page.getByTitle('Toggle Performance Debug (D)').click();
    await expect(page.locator('text=Performance Diagnostic')).not.toBeVisible();
  });

  test('should toggle debug panel via keyboard shortcut "D"', async ({ page }) => {
    await expect(page.locator('text=Performance Diagnostic')).not.toBeVisible();

    await page.keyboard.press('d');
    await expect(page.locator('text=Performance Diagnostic')).toBeVisible();

    await page.keyboard.press('D'); // Shift+D should also work
    await expect(page.locator('text=Performance Diagnostic')).not.toBeVisible();
  });

  test('should be draggable', async ({ page }) => {
    await page.keyboard.press('d');
    const panel = page.locator('text=Performance Diagnostic').locator('..').locator('..'); // Get the container
    
    const initialBox = await panel.boundingBox();
    if (!initialBox) throw new Error('Could not find panel bounding box');

    // Drag from the header
    const header = page.locator('text=Performance Diagnostic');
    await header.hover();
    await page.mouse.down();
    await page.mouse.move(initialBox.x + 200, initialBox.y + 200);
    await page.mouse.up();

    const finalBox = await panel.boundingBox();
    if (!finalBox) throw new Error('Could not find panel bounding box');

    expect(finalBox.x).toBeGreaterThan(initialBox.x);
    expect(finalBox.y).toBeGreaterThan(initialBox.y);
  });
});
