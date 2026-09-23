import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5180',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.CHROME_PATH },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium' } },
    { name: 'development', testMatch: '**/branch-request.spec.ts', use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5190' } },
  ],
  webServer: [{
    command: 'pnpm build && pnpm preview --host 127.0.0.1 --port 5180 --strictPort',
    url: 'http://127.0.0.1:5180',
  }, {
    command: 'pnpm dev --host 127.0.0.1 --port 5190 --strictPort',
    url: 'http://127.0.0.1:5190',
    env: { VITE_CACHE_DIR: 'node_modules/.vite-e2e' },
  }],
})
