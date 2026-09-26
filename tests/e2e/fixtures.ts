import { test as base, expect, type BrowserContext, type Page } from '@playwright/test'

export { expect }
export type { Page } from '@playwright/test'

/**
 * UI tests never reach the outside world: every request that is not to the
 * app itself is aborted. Tests fake the endpoints they need with `page.route`,
 * which takes precedence over this.
 */
export async function blockOutsideTraffic(target: Page | BrowserContext) {
  await target.route('**/*', (route) =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
}

/** `test`, with outside traffic blocked in every test's browser context. */
export const test = base.extend({
  context: async ({ context }, provide) => {
    await blockOutsideTraffic(context)
    await provide(context)
  },
})
