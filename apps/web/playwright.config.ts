import { defineConfig } from '@playwright/test';

/**
 * Playwright config for real-browser (chromium headless) E2E tests.
 * These run against the dev server (Vite on :5175) + the API server (:4310).
 * Start both before running: `npm run dev` in apps/server and apps/web.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5175',
    headless: true,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
