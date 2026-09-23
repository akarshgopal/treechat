import { spawnSync } from 'node:child_process'

// Keep the original verification entry point; the full journey now runs in
// desktop and mobile Chromium through Playwright. CHROME_PATH is optional.
const result = spawnSync('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
})
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
