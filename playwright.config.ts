import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    // Chromium flag to auto-approve screen sharing
    launchOptions: {
      args: [
        '--auto-select-desktop-capture-source=Entire screen',
        '--enable-features=ScreenCapture',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream'
      ]
    }
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /mic-sync-sessions\.spec\.ts/,
      // The 20 ms narration-sync gate holds on an idle machine only (parallel-worker CPU load
      // skews Chrome's capture clocks; see the #48 web-limitations note), so it runs on its own,
      // after every other test has finished, and even if some of them failed.
      teardown: 'chromium-mic-sync-idle',
    },
    {
      name: 'chromium-mic-sync-idle',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /mic-sync-sessions\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
  },
});
