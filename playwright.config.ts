import { defineConfig, devices } from '@playwright/test'

// Overridable so several checkouts (e.g. git worktrees) can run e2e at once.
const PORT = Number(process.env.E2E_PORT ?? 5180)
const DEV_PORT = Number(process.env.E2E_DEV_PORT ?? 5190)

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.CHROME_PATH },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium' } },
    { name: 'development', testMatch: '**/branch-request.spec.ts', use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${DEV_PORT}` } },
  ],
  webServer: [{
    command: `pnpm build && pnpm preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
  }, {
    command: `pnpm dev --host 127.0.0.1 --port ${DEV_PORT} --strictPort`,
    url: `http://127.0.0.1:${DEV_PORT}`,
    env: { VITE_CACHE_DIR: 'node_modules/.vite-e2e' },
  }],
})
