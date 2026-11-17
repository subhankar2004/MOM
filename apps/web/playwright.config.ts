import { defineConfig, devices } from '@playwright/test';
import { API_PORT, apiEnv, WEB_PORT, WEB_URL } from './e2e/support/env';

/**
 * Browser tests against a production build of the web app plus the real API and the
 * mom_test database. Run with `npm run e2e -w @mom/web` (builds first) — needs Postgres
 * (`npm run db:up`). Two viewports: a small Android phone (360 px — spec §11) and a desktop.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'phone-360',
      dependencies: ['setup'],
      use: { ...devices['Pixel 7'], viewport: { width: 360, height: 780 } },
    },
    {
      name: 'desktop',
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: [
    {
      name: 'api',
      command: 'npx tsx src/server.ts',
      cwd: '../api',
      url: `http://127.0.0.1:${API_PORT}/health`,
      env: apiEnv(),
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      name: 'web',
      command: `npx next start --port ${WEB_PORT} --hostname 127.0.0.1`,
      url: `${WEB_URL}/manifest.webmanifest`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
