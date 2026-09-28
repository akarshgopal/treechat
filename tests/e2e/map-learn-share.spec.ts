import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from './fixtures'
import { tree } from './library'
import { restoreDemo, selectText } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

/** On phones, What did I learn? and Share live in the app bar's ⋯ menu. */
async function chatAction(page: Page, mobile: boolean, testId: 'open-learn' | 'share-html') {
  if (mobile) await page.getByTestId('chat-menu').click()
  await page.getByTestId(testId).click()
}

test('the map shows the whole tree, marks what is new, and opens a branch', async ({ page }) => {
  await restoreDemo(page)
  // Leave a branch answering, so the map has something new.
  await selectText(page, '[data-message-id="msg-root-4"]', 'Closed branches keep a quiet underline')
  await page.locator('[data-lens="explain"]').click()
  await expect(page.getByTestId('branch-lane')).toBeVisible()
  await page.getByTestId('back-to-spine').click()
  await expect(page.getByTestId('map-new')).toHaveText('1 new', { timeout: 15_000 })

  await page.getByTestId('open-map').click()
  const map = page.getByTestId('map')
  await expect(map).toBeVisible()
  await expect(map.getByTestId('map-counts')).toHaveText('3 branches · 1 new')
  const cards = map.getByTestId('map-card')
  await expect(cards).toHaveCount(4)
  await expect(cards.first()).toHaveAttribute('aria-current', 'true')
  await expect(map.getByText('“select any passage and grow a branch from it”')).toBeVisible()
  await expect(map.getByRole('img', { name: 'New reply' })).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(map).toHaveCount(0)

  await page.getByTestId('open-map').click()
  await map.locator('[data-thread-id="thread-branch-1"]').click()
  await expect(map).toHaveCount(0)
  await expect(page.getByTestId('branch-anchor').last()).toContainText('select any passage and grow a branch from it')
  await expect.poll(async () => (await tree(page)).activeThreadId).toBe('thread-branch-1')
  await page.getByTestId('open-map').click()
  await expect(map.locator('[data-thread-id="thread-branch-1"]')).toHaveAttribute('aria-current', 'true')
})

test('What did I learn? streams a summary of the chat, then it can be edited, copied and saved', async ({ page, context }, testInfo) => {
  const mobile = Boolean(testInfo.project.use.isMobile)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await restoreDemo(page)
  await chatAction(page, mobile, 'open-learn')
  const drawer = page.getByTestId('learn-drawer')
  const text = drawer.getByTestId('learn-text')
  await expect(text).toHaveJSProperty('readOnly', true)
  await expect(text).toHaveJSProperty('readOnly', false, { timeout: 15_000 })
  const summary = await text.inputValue()
  expect(summary).toMatch(/^# What is TreeChat\?\n\nThis demo summary covers “What is TreeChat\?” and its 2 branches\./)
  expect(summary).toContain('## Also explored\n- If I keep talking on the main thread')
  expect(summary).toContain('- So how deep does this actually go?')

  await text.fill(`${summary}\nMy own note.`)
  await drawer.getByTestId('learn-copy').click()
  await expect(page.getByText('Copied as Markdown')).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('My own note.')

  const download = page.waitForEvent('download')
  await drawer.getByTestId('learn-download').click()
  const file = await download
  expect(file.suggestedFilename()).toBe('what-is-treechat-what-i-learned.md')
  expect(await readFile((await file.path())!, 'utf8')).toContain('My own note.')
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
})

test('in a branch, What did I learn? covers that branch and what grew from it', async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'scope is the same on phones')
  await restoreDemo(page)
  await page.getByTestId('tree-rail').locator('[data-thread-id="thread-branch-1"]').click()
  await page.getByTestId('open-learn').click()
  const text = page.getByTestId('learn-drawer').getByTestId('learn-text')
  await expect(text).toHaveJSProperty('readOnly', false, { timeout: 15_000 })
  const summary = await text.inputValue()
  expect(summary).toMatch(/^# If I keep talking on the main thread/)
  expect(summary).toContain('and its 1 branch.')
  expect(summary).toContain('- So how deep does this actually go?')
})

test('a failed summary says why and can be tried again', async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'the drawer is the same on phones')
  await page.evaluate(() => localStorage.setItem('treechat:provider:v1', JSON.stringify({ provider: 'openrouter', apiKey: 'test-key', model: 'openai/gpt-5.6-luna' })))
  await page.reload()
  let calls = 0
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    calls += 1
    if (calls === 1) return route.fulfill({ status: 500, body: JSON.stringify({ error: { message: 'Upstream is down' } }) })
    const body = ['Lead.', '\n\n## Takeaways\n- **A** B'].map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`).join('') + 'data: [DONE]\n\n'
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body })
  })
  await restoreDemo(page)
  await page.getByTestId('open-learn').click()
  const drawer = page.getByTestId('learn-drawer')
  await expect(drawer.getByRole('alert')).toHaveText('Upstream is down')
  await drawer.getByRole('button', { name: 'Try again' }).click()
  await expect(drawer.getByTestId('learn-text')).toHaveValue('# What is TreeChat?\n\nLead.\n\n## Takeaways\n- **A** B\n')
  expect(calls).toBe(2)
})

test('Share saves one read-only HTML file of the whole tree', async ({ page }, testInfo) => {
  const mobile = Boolean(testInfo.project.use.isMobile)
  await restoreDemo(page)
  const download = page.waitForEvent('download')
  await chatAction(page, mobile, 'share-html')
  const file = await download
  expect(file.suggestedFilename()).toBe('what-is-treechat.html')
  const html = await readFile((await file.path())!, 'utf8')
  expect(html).toContain('<title>What is TreeChat?</title>')
  expect(html).toContain('<details class="branch"><summary><span class="title">So how deep does this actually go?')
  expect(html).not.toMatch(/<script|<link|\ssrc=/i)
  await expect(page.getByText('Saved what-is-treechat.html')).toBeVisible()

  // The copy renders on its own, with nothing to fetch.
  const requests: string[] = []
  const copy = await page.context().newPage()
  copy.on('request', (request) => { if (!request.url().startsWith('data:')) requests.push(request.url()) })
  await copy.setContent(html)
  await expect(copy.getByRole('heading', { level: 1 })).toHaveText('What is TreeChat?')
  await expect(copy.getByText('As deep as you like')).toBeHidden()
  await copy.locator('summary', { hasText: 'If I keep talking' }).click()
  await copy.locator('summary', { hasText: 'So how deep' }).click()
  await expect(copy.getByText('As deep as you like')).toBeVisible()
  expect(requests).toEqual([])
})
