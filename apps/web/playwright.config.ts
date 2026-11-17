import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

/**
 * Browser tests against a production build (`npm run build` with SHOW_DEV_PAGES=1 first).
 * Two viewports: a small Android phone (360 px — spec §11) and a desktop.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'phone-360',
      use: { ...devices['Pixel 7'], viewport: { width: 360, height: 780 } },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: `npx next start --port ${PORT} --hostname 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/manifest.webmanifest`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
