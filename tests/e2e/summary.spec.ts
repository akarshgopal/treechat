import { expect, test } from '@playwright/test'
import { tree } from './library'

/** A main thread long enough that its older turns outgrow the summary trigger. */
function longLibrary() {
  const messages = Array.from({ length: 20 }, (_, i) => ({
    id: `long-${i}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Turn ${i} about query plans. `.padEnd(2400, 'Indexes and statistics matter. '),
    createdAt: i,
  }))
  const treeState = {
    threads: { root: { id: 'root', parentId: null, anchor: null, messages, createdAt: 0, rev: 0 } },
    rootId: 'root',
    activeThreadId: 'root',
    expanded: {},
  }
  return {
    sessions: [{ id: 'long', title: 'Long chat', createdAt: 0, updatedAt: 0, treeState, titleLocked: true }],
    activeSessionId: 'long',
  }
}

test.beforeEach(async ({ page }) => {
  // Static-site mock only: never reach a real provider from UI tests.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/status') return route.fulfill({ status: 404, body: 'Static mock' })
    if (url.hostname !== '127.0.0.1') return route.abort()
    return route.continue()
  })
  const library = longLibrary()
  await page.addInitScript((value) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('treechat:v3', value)
      sessionStorage.setItem('seeded', '1')
    }
  }, JSON.stringify(library))
  await page.goto('/')
  await expect(page.locator('[data-message-id="long-19"]')).toBeAttached()
})

test('a long thread is summarized after a reply and says so in the transcript', async ({ page }) => {
  await expect(page.getByTestId('summary-divider')).toHaveCount(0)
  const composer = page.getByRole('textbox', { name: 'Message to Main conversation', exact: true })
  await composer.fill('What is TreeChat?')
  await composer.press('Enter')
  await expect(page.getByTestId('reply-progress')).toHaveCount(0, { timeout: 10_000 })

  await expect.poll(async () => (await tree(page)).threads.root.summary?.throughMessageId, { timeout: 10_000 }).toBe('long-15')
  const summary = (await tree(page)).threads.root.summary!
  expect(summary.content).toContain('Turn 15 about query plans')

  // The divider sits right before the first message still sent in full.
  const divider = page.getByTestId('summary-divider')
  await expect(divider).toHaveCount(1)
  const firstInFull = page.locator('[data-message-id="long-16"]')
  await expect(firstInFull).toBeAttached()
  expect(await divider.evaluate((element, id) => {
    const next = document.querySelector(`[data-message-id="${id}"]`)!
    return Boolean(element.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING)
  }, 'long-16')).toBe(true)

  await divider.getByRole('button', { name: 'Earlier messages are summarized for the model' }).click()
  await expect(page.getByTestId('summary-text')).toContainText('Turn 15 about query plans')

  // Persisted: still there after a reload.
  await page.reload()
  await expect(page.getByTestId('summary-divider')).toHaveCount(1)
})

test('edit & resend inside the summarized part drops the summary', async ({ page }) => {
  const composer = page.getByRole('textbox', { name: 'Message to Main conversation', exact: true })
  await composer.fill('What is TreeChat?')
  await composer.press('Enter')
  await expect.poll(async () => (await tree(page)).threads.root.summary?.throughMessageId, { timeout: 10_000 }).toBe('long-15')
  await expect(page.getByTestId('summary-divider')).toHaveCount(1)

  const summarized = page.locator('[data-message-id="long-10"]')
  await summarized.scrollIntoViewIfNeeded()
  await summarized.click()
  await summarized.locator('xpath=ancestor::article[1]').getByTestId('message-edit').click()
  await page.getByTestId('message-edit-input').fill('A different question')
  await page.getByTestId('message-edit-save').click()
  await page.getByTestId('rewrite-confirm-action').click()

  await expect.poll(async () => (await tree(page)).threads.root.summary).toBeUndefined()
  await expect(page.getByTestId('summary-divider')).toHaveCount(0)
})
