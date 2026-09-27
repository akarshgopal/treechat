import { expect, test, type Page } from './fixtures'
import { afterSaves, tree } from './library'

async function restoreDemo(page: Page) {
  await page.getByTestId('settings-button').click()
  await page.getByTestId('settings-restore-demo').click()
  await expect(page.locator('[data-message-id="msg-root-4"]')).toBeAttached()
  // Saved, so a snapshot taken next is the demo.
  await afterSaves(page)
}

test.beforeEach(async ({ page }) => {
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
  await page.locator('article').first().click()
  await page.getByTestId('message-edit').first().click()
  await page.getByTestId('message-edit-input').fill('What is TreeChat, briefly?')
  await page.getByTestId('message-edit-save').click()
  await expect(page.getByTestId('rewrite-confirm')).toContainText('4 later messages and 2 branches')

  await page.getByRole('button', { name: 'Keep conversation' }).click()
  await afterSaves(page)
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

test('discarding a branch happens at once and Undo brings it back', async ({ page }) => {
  await restoreDemo(page)
  await page.locator('button[aria-label^="Open branch"]').first().click()
  const before = Object.keys((await tree(page)).threads).sort()
  await page.getByTestId('branch-menu').click()
  await page.getByTestId('discard-branch').click()
  await expect.poll(async () => Object.keys((await tree(page)).threads)).toEqual(['thread-root'])
  await expect(page.getByTestId('branch-lane')).toHaveCount(0)
  await page.getByTestId('toast').getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => Object.keys((await tree(page)).threads).sort()).toEqual(before)
  await expect(page.getByTestId('branch-lane')).toBeVisible()
})

test('Settings saves a model id pasted into the picker even when OpenRouter’s list is unreachable', async ({ page }) => {
  await page.getByTestId('settings-button').click()
  await page.getByTestId('settings-model').click()
  // The list request is blocked in tests: suggestions still show, and so does why.
  await expect(page.getByTestId('settings-model-options')).toContainText('Could not load OpenRouter’s full list')
  await page.getByTestId('settings-model-search').fill('anthropic/claude-sonnet-4')
  await page.getByTestId('settings-model-search').press('Enter')
  await expect(page.getByTestId('settings-model')).toHaveAttribute('data-value', 'anthropic/claude-sonnet-4')
  await page.getByTestId('settings-save').click()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('treechat:provider:v1')!).model)).toBe('anthropic/claude-sonnet-4')
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

test('an empty chat offers starter questions that send at once', async ({ page }) => {
  await page.getByTestId('starters').getByRole('button', { name: 'How does TreeChat keep long chats usable?' }).click()
  await expect(page.getByTestId('empty-chat-guide')).toHaveCount(0)
  await expect(page.locator('article').last()).toContainText('running summary')
})
