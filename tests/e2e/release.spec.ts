import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

async function sessionIds(page: Page): Promise<string[]> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('treechat:v3')!).sessions.map((session: { id: string }) => session.id))
}

test.beforeEach(async ({ page }) => {
  // Static-site mock only: never reach a real provider from UI tests.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/status') return route.fulfill({ status: 404, body: 'Static mock' })
    if (url.hostname !== '127.0.0.1') return route.abort()
    return route.continue()
  })
  await page.goto('/')
})

test('chats export to JSON and import into another browser', async ({ page, browser }, testInfo) => {
  await page.getByTestId('show-demo').click()
  await page.getByTestId('settings-button').click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('settings-export').click()])
  expect(download.suggestedFilename()).toMatch(/^treechat-chats-\d{4}-\d{2}-\d{2}\.json$/)
  const file = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(file).toMatchObject({ format: 'treechat-export', version: 1 })
  expect(file.sessions[0].title).toBe('What is TreeChat?')

  // A fresh browser: its blank chat gives way to the imported one.
  const context = await browser.newContext({ ...testInfo.project.use })
  const other = await context.newPage()
  await other.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/status') return route.fulfill({ status: 404, body: 'Static mock' })
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort()
  })
  await other.goto('/')
  await other.getByTestId('settings-button').click()
  await other.getByTestId('settings-import-input').setInputFiles({ name: 'chats.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) })
  await expect(other.getByTestId('toast')).toContainText('Imported 1 chat')
  await expect(other.locator('[data-message-id="msg-root-4"]')).toBeAttached()
  expect(await sessionIds(other)).toEqual([file.sessions[0].id])

  // The same file again changes nothing; a foreign file is refused.
  await other.getByTestId('settings-button').click()
  await other.getByTestId('settings-import-input').setInputFiles({ name: 'chats.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) })
  await expect(other.getByTestId('toast')).toContainText('already here')
  expect(await sessionIds(other)).toHaveLength(1)
  await other.getByTestId('settings-button').click()
  await other.getByTestId('settings-import-input').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') })
  await expect(other.getByTestId('toast')).toContainText('not a TreeChat export')
  await context.close()
})

test('a full storage warns and keeps every chat instead of deleting old ones', async ({ page }) => {
  await page.getByTestId('show-demo').click()
  const saved = await page.evaluate(() => localStorage.getItem('treechat:v3'))
  // From now on the browser refuses to store the chat library.
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'treechat:v3') throw new DOMException('Quota exceeded', 'QuotaExceededError')
      return setItem.call(this, key, value)
    }
  })
  await page.getByTestId('thread-composer').fill('One more message')
  await page.getByTestId('thread-composer').press('Enter')
  const warning = page.getByTestId('storage-full')
  await expect(warning).toBeVisible()
  await expect(warning).toContainText('recent changes are not being saved')
  expect(await page.evaluate(() => localStorage.getItem('treechat:v3'))).toBe(saved)
  const [download] = await Promise.all([page.waitForEvent('download'), warning.getByRole('button', { name: 'Export chats' }).click()])
  // The export has what storage could not hold.
  expect(await readFile((await download.path())!, 'utf8')).toContain('One more message')
})

test('turning on web search with a key mentions its cost once', async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'the same toast on phones')
  await page.evaluate(() => localStorage.setItem('treechat:provider:v1', JSON.stringify({ provider: 'openrouter', apiKey: 'test-only-never-sent', model: 'openai/gpt-4.1-mini' })))
  await page.reload()
  const globe = page.getByTestId('web-search-toggle')
  await expect(globe).toHaveAttribute('title', /small OpenRouter fee/)
  await globe.click()
  await expect(page.getByTestId('toast')).toContainText('each search adds a small fee')
  await page.getByTestId('toast').getByRole('button', { name: 'Got it' }).click()
  await globe.click()
  await globe.click()
  await expect(page.getByTestId('toast')).toHaveCount(0)
})

test('Settings says where data goes and links to bug reports', async ({ page }) => {
  await page.getByTestId('settings-button').click()
  await expect(page.getByTestId('settings-dialog')).toContainText('Use a key with a credit limit')
  await page.getByTestId('settings-privacy').locator('summary').click()
  await expect(page.getByTestId('settings-privacy')).toContainText('r.jina.ai')
  await expect(page.getByTestId('report-problem')).toHaveAttribute('href', 'https://github.com/akarshgopal/treechat/issues/new')
})
