import { expect, test, type Page } from '@playwright/test'
import type { TreeState } from '../../src/types'

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

async function select(page: Page, messageId: string, length: number) {
  const message = page.locator(`[data-message-id="${messageId}"]`)
  await message.scrollIntoViewIfNeeded()
  await message.evaluate((element, length) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const node = walker.nextNode()!
    const range = document.createRange()
    range.setStart(node, 0)
    range.setEnd(node, length)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  }, length)
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

test('the reading column never overflows its viewport', async ({ page }) => {
  await restoreDemo(page)
  const overflow = await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('[data-testid="thread-scroll"] [data-radix-scroll-area-viewport]')!
    return viewport.scrollWidth - viewport.clientWidth
  })
  expect(overflow).toBeLessThanOrEqual(0)
})

test('editing an early message asks before removing later turns and branches', async ({ page }) => {
  await restoreDemo(page)
  const before = await tree(page)
  await page.locator('article').first().hover()
  await page.getByTestId('message-edit').first().click()
  await page.getByTestId('message-edit-input').fill('What is TreeChat, briefly?')
  await page.getByTestId('message-edit-save').click()
  await expect(page.getByTestId('rewrite-confirm')).toContainText('4 later messages and 2 branches')

  await page.getByRole('button', { name: 'Keep conversation' }).click()
  expect(await tree(page)).toEqual(before)
  await expect(page.getByTestId('message-edit-input')).toHaveValue('What is TreeChat, briefly?')

  await page.getByTestId('message-edit-save').click()
  await page.getByTestId('rewrite-confirm-action').click()
  await expect.poll(async () => Object.keys((await tree(page)).threads)).toEqual([before.rootId])
})

test('regenerating the last reply does not ask', async ({ page }) => {
  await restoreDemo(page)
  await page.locator('[data-testid="message-retry"]').last().click({ force: true })
  await expect(page.getByTestId('rewrite-confirm')).toHaveCount(0)
  await expect.poll(async () => (await tree(page)).threads['thread-root'].messages).toHaveLength(6)
})

test('the branch shortcut ignores a passage that was deselected', async ({ page }) => {
  await restoreDemo(page)
  await select(page, 'msg-root-4', 20)
  await expect(page.getByTestId('branch-chip')).toBeVisible()
  await page.evaluate(() => {
    window.getSelection()!.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))
  })
  await expect(page.getByTestId('branch-chip')).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+Shift+B')
  await expect(page.getByTestId('branch-question')).toHaveCount(0)
})

test('discarding a branch confirms and Escape only closes the dialog', async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'focused branch view is covered on desktop')
  await restoreDemo(page)
  await page.locator('button[aria-label^="Open branch"]').first().click()
  await page.getByTestId('open-as-conversation').click()
  await page.getByTestId('discard-branch').click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(page.getByTestId('back-to-spine')).toBeVisible()
  await page.getByTestId('discard-branch').click()
  await page.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect.poll(async () => Object.keys((await tree(page)).threads)).toEqual(['thread-root'])
})

test('a half-typed model id is not saved from the header', async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'header model picker is desktop-only')
  await page.getByTestId('header-model').fill('anthro')
  await page.getByTestId('header-model').press('Tab')
  await expect(page.getByTestId('header-model')).toHaveValue('openai/gpt-4.1-mini')
  expect(await page.evaluate(() => localStorage.getItem('treechat:provider:v1'))).toBeNull()
})

test('New chat reuses a blank chat instead of stacking empty ones', async ({ page }, testInfo) => {
  await restoreDemo(page)
  await page.getByTestId('new-chat').click()
  await page.getByTestId('new-chat').click()
  await page.getByTestId('new-chat').click()
  // Mobile lists chats in the switcher dialog; desktop in the sidebar.
  const list = testInfo.project.use.isMobile ? page.getByTestId('session-library') : page.getByTestId('chat-sidebar')
  if (testInfo.project.use.isMobile) await page.getByTestId('session-switcher').click()
  await expect(list.getByTestId('session-row')).toHaveCount(2)
})

test('an empty chat offers the walkthrough', async ({ page }) => {
  await page.getByTestId('show-demo').click()
  await expect(page.locator('[data-message-id="msg-root-4"]')).toBeAttached()
})
