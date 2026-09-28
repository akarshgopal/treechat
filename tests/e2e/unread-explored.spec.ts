import { expect, test, type Page } from './fixtures'
import { tree } from './library'
import { restoreDemo, selectText } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

/** The sidebar tree; on phones it lives in the chat switcher. */
async function openTree(page: Page, mobile: boolean) {
  if (mobile) await page.getByTestId('session-switcher').click()
  return page.getByTestId('tree-rail')
}

test('a reply that finishes out of sight gets a dot until its branch is opened', async ({ page }, testInfo) => {
  const mobile = Boolean(testInfo.project.use.isMobile)
  await restoreDemo(page)
  await selectText(page, '[data-message-id="msg-root-4"]', 'Closed branches keep a quiet underline')
  await page.locator('[data-lens="explain"]').click()
  // Leave before the reply is done.
  await expect(page.getByTestId('branch-lane')).toBeVisible()
  await page.getByTestId('back-to-spine').click()
  await expect.poll(async () => Object.values((await tree(page)).threads).filter((thread) => thread.unread).length, { timeout: 15_000 }).toBe(1)
  const rail = await openTree(page, mobile)
  const row = rail.locator('[role="treeitem"]', { has: page.getByTestId('thread-unread') })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('Explain')
  await expect(page.getByTestId('session-unread')).toHaveCount(1)

  await row.click()
  await expect(page.getByTestId('branch-lane')).toBeVisible()
  await expect.poll(async () => Object.values((await tree(page)).threads).filter((thread) => thread.unread).length).toBe(0)
  await openTree(page, mobile)
  await expect(page.getByTestId('thread-unread')).toHaveCount(0)
  await expect(page.getByTestId('session-unread')).toHaveCount(0)
})

test('a reply finishing in the branch being read gets no dot', async ({ page }) => {
  await restoreDemo(page)
  await selectText(page, '[data-message-id="msg-root-4"]', 'Closed branches keep a quiet underline')
  await page.locator('[data-lens="simpler"]').click()
  await expect(page.getByTestId('composer-stop')).toHaveCount(0, { timeout: 15_000 })
  const threads = Object.values((await tree(page)).threads)
  expect(threads.some((thread) => thread.messages.some((message) => message.content.startsWith('Say “')))).toBe(true)
  expect(threads.filter((thread) => thread.unread)).toHaveLength(0)
})

test('a passage with a branch on it says so at once, and Open goes there', async ({ page }) => {
  await restoreDemo(page)
  await selectText(page, '[data-message-id="msg-root-2"]', 'grow a branch from it')
  const match = page.getByTestId('branch-popover').getByTestId('explored-match')
  await expect(match).toHaveCount(1)
  await expect(match).toContainText('Explored before: If I keep talking on the main thread')
  await expect(match).toContainText('this chat')
  await match.getByTestId('explored-open').click()
  await expect(page.getByTestId('branch-popover')).toHaveCount(0)
  await expect(page.getByTestId('branch-anchor')).toContainText('select any passage and grow a branch from it')
})

test('typing a question already explored offers the branch above the composer; × dismisses it', async ({ page }) => {
  await restoreDemo(page)
  const composer = page.getByTestId('thread-composer')
  await composer.fill('Does a branch lose its place?')
  const match = page.getByTestId('explored-match')
  await expect(match).toHaveCount(1)
  await expect(match).toContainText('If I keep talking on the main thread')
  await match.getByRole('button', { name: 'Dismiss' }).click()
  await expect(match).toHaveCount(0)
  await composer.fill('Does a branch lose its place in the sentence?')
  await expect(match).toHaveCount(0)
  await composer.fill('How deep does this go?')
  await expect(match).toContainText('So how deep does this actually go?')
  await match.getByTestId('explored-open').click()
  await expect(page.getByTestId('branch-anchor').last()).toContainText('you can select a passage in here and branch again')
})

test('typing in the question box looks across other chats too', async ({ page }) => {
  await restoreDemo(page)
  // A second chat with nothing in it: the demo chat's branches are "in" another chat from here.
  await page.getByTestId('new-chat').click()
  await page.getByTestId('thread-composer').fill('Does a branch lose its place?')
  const match = page.getByTestId('explored-match')
  await expect(match).toContainText('in “What is TreeChat?”')
  await match.getByTestId('explored-open').click()
  await expect(page.getByTestId('branch-anchor')).toContainText('select any passage and grow a branch from it')
  await expect(page.getByTestId('session-title').first()).toContainText('What is TreeChat?')
})
