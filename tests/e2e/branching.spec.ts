import { expect, test, type Page } from '@playwright/test'
import type { TreeState } from '../../src/types'

const question = 'What does this mean in practice?'
const takeaway = 'Keep each exploration anchored to its source, then bring the useful conclusion back.'

async function tree(page: Page) {
  return page.evaluate(() => {
    const library = JSON.parse(localStorage.getItem('treechat:v3')!)
    return library.sessions.find((session: { id: string }) => session.id === library.activeSessionId).treeState as TreeState
  })
}

async function restoreDemo(page: Page) {
  await page.getByTestId('settings-button').click()
  await page.getByTestId('settings-restore-demo').click()
  await expect(page.locator('[data-message-id="msg-root-4"]')).toBeAttached()
}

async function selectPassage(page: Page) {
  const message = page.locator('[data-message-id="msg-root-4"]')
  await message.scrollIntoViewIfNeeded()
  await message.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const node = walker.nextNode()!
    const range = document.createRange()
    range.setStart(node, 0)
    range.setEnd(node, 'Highlight text in any message, in any thread.'.length)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
  await page.getByTestId('branch-chip').click()
}

test.beforeEach(async ({ page }) => {
  // Exercise the static site's browser mock. Never use local .env credentials
  // or send a request to a real model provider during UI tests.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/status') return route.fulfill({ status: 404, body: 'Static mock' })
    if (url.hostname !== '127.0.0.1') return route.abort()
    return route.continue()
  })
  await page.goto('/')
})

test('select, ask, expand, review takeaway, return to source, and undo', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await restoreDemo(page)
  const before = await tree(page)
  await selectPassage(page)
  await expect(page.getByLabel('Your branch question')).toBeFocused()
  await expect.poll(async () => Object.keys((await tree(page)).threads).length).toBe(3)
  await page.getByRole('button', { name: 'Cancel branch', exact: true }).click()
  await expect(page.getByTestId('branch-question')).toHaveCount(0)
  expect(Object.keys((await tree(page)).threads)).toEqual(Object.keys(before.threads))

  await selectPassage(page)
  await expect(page.getByTestId('branch-question')).not.toContainText('Ask about this')
  await expect(page.getByTestId('branch-question')).not.toContainText('A separate conversation')
  await page.getByLabel('Your branch question').fill(question)
  await page.screenshot({ path: testInfo.outputPath('ask-about-passage.png') })
  await page.getByLabel('Your branch question').press('Enter')
  await expect.poll(async () => Object.keys((await tree(page)).threads).length).toBe(4)
  await expect(page.getByTestId('composer-stop')).toHaveCount(0)
  const branched = await tree(page)
  const branch = Object.values(branched.threads).find((entry) => entry.messages.some((message) => message.content === question))!
  expect(branch.messages.filter((message) => message.role === 'user')).toHaveLength(1)
  expect(branch.messages.some((message) => message.role === 'assistant' && message.content.length > 0)).toBe(true)
  expect(branched.threads[branched.rootId].messages).toEqual(before.threads[before.rootId].messages)

  if (!testInfo.project.use.isMobile) {
    await page.getByTestId('open-as-conversation').click()
  }
  await expect(page.getByTestId('back-to-spine')).toBeVisible()
  await expect(page.getByTestId('reply-destination')).toHaveCount(0)
  await expect(page.getByTestId('back-to-spine')).toContainText('Highlight text')
  await page.getByRole('textbox', { name: `Message to ${question}`, exact: true }).fill('A draft worth keeping')
  await page.screenshot({ path: testInfo.outputPath('focused-exploration.png') })
  await page.getByTestId('drop-summary').click()
  await expect(page.getByTestId('takeaway-dialog')).toBeVisible()
  await expect(page.getByLabel('Your takeaway', { exact: true })).toBeVisible()
  expect((await tree(page)).threads[before.rootId].messages).toHaveLength(6)
  await page.getByLabel('Your takeaway', { exact: true }).fill(takeaway)
  await page.screenshot({ path: testInfo.outputPath('review-takeaway.png') })
  await page.getByTestId('confirm-takeaway').click()
  await expect(page.getByTestId('takeaway-dialog')).toHaveCount(0)
  await expect(page.locator('[data-view="spine"]')).toBeVisible()
  await expect(page.locator('.source-return').first()).toBeVisible()
  const merged = await tree(page)
  expect(merged.threads[before.rootId].messages.at(-1)).toMatchObject({ content: takeaway, sourceThreadId: branch.id, kind: 'drop-summary' })
  expect(merged.threads[branch.id]).toBeDefined()
  await page.getByRole('button', { name: 'View takeaway', exact: true }).click()
  await expect(page.locator('[data-takeaway-id]')).toContainText(takeaway)
  await page.getByRole('button', { name: 'View exploration', exact: true }).click()
  await expect(page.getByRole('textbox', { name: `Message to ${question}`, exact: true })).toHaveValue('A draft worth keeping')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  expect((await tree(page)).threads[before.rootId].messages).toHaveLength(6)
  expect((await tree(page)).threads[branch.id]).toBeDefined()
  expect(errors).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('message action supports touch and drafts stay with their chat', async ({ page }, testInfo) => {
  await expect(page.getByTestId('empty-chat-guide')).toBeVisible()
  await page.getByRole('textbox', { name: 'Message to Main conversation', exact: true }).fill('First chat draft')
  const firstSession = await page.evaluate(() => JSON.parse(localStorage.getItem('treechat:v3')!).activeSessionId)
  await page.getByTestId('new-chat').click()
  await expect(page.getByRole('textbox', { name: 'Message to Main conversation', exact: true })).toHaveValue('')
  await page.getByRole('textbox', { name: 'Message to Main conversation', exact: true }).fill('Second chat draft')
  if (testInfo.project.use.isMobile) await page.getByTestId('session-switcher').click()
  await page.locator(`[data-testid="session-row"][data-session-id="${firstSession}"]`).getByRole('button').first().click()
  await expect(page.getByRole('textbox', { name: 'Message to Main conversation', exact: true })).toHaveValue('First chat draft')
  await restoreDemo(page)
  await page.locator('[data-ask-message="msg-root-4"]').click()
  await expect(page.getByLabel('Your branch question')).toBeFocused()
  await page.getByLabel('Your branch question').press('Escape')
  await expect(page.getByTestId('branch-question')).toHaveCount(0)
  await expect(page.locator('[data-ask-message="msg-root-4"]')).toBeFocused()
  expect(Object.keys((await tree(page)).threads)).toHaveLength(3)
})

test('failed takeaways can be cancelled or written manually and remain linked after reload', async ({ page }) => {
  await restoreDemo(page)
  await page.locator('button[aria-label^="Open branch"]').first().click()
  await page.getByTestId('open-as-conversation').click()
  await page.evaluate(() => localStorage.setItem('treechat:provider:v1', JSON.stringify({ provider: 'openrouter', apiKey: 'test-only-never-sent', model: 'test-model' })))
  await page.route('https://openrouter.ai/**', (route) => route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Provider temporarily unavailable' } }),
  }))
  await page.reload()
  await page.getByTestId('drop-summary').click()
  await expect(page.getByRole('alert')).toContainText('Provider temporarily unavailable')
  await expect(page.getByTestId('confirm-takeaway')).toBeDisabled()
  await page.getByLabel('Your takeaway', { exact: true }).fill('An unsaved takeaway')
  await page.getByLabel('Your takeaway', { exact: true }).press('Escape')
  await expect(page.getByTestId('takeaway-dialog')).toHaveCount(0)
  await expect(page.getByTestId('back-to-spine')).toBeVisible()
  expect((await tree(page)).threads['thread-root'].messages).toHaveLength(6)

  await page.getByTestId('drop-summary').click()
  await page.getByLabel('Your takeaway', { exact: true }).fill(takeaway)
  await page.getByTestId('confirm-takeaway').click()
  await page.reload()
  await expect(page.locator('[data-takeaway-id]')).toContainText(takeaway)
  await page.getByRole('button', { name: 'View exploration', exact: true }).click()
  await expect(page.getByTestId('back-to-spine')).toBeVisible()
  expect((await tree(page)).activeThreadId).toBe('thread-branch-1')
})
