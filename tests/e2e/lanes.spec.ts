import { expect, test, type Page } from '@playwright/test'
import { savedLibrary, tree } from './library'

/** Select `length` characters of a message's first text node from `from`. */
async function select(page: Page, messageId: string, from: number, length: number) {
  const message = page.locator(`[data-message-id="${messageId}"]`)
  await message.scrollIntoViewIfNeeded()
  await message.evaluate((element, [from, length]) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const node = walker.nextNode()!
    const range = document.createRange()
    range.setStart(node, from)
    range.setEnd(node, from + length)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  }, [from, length])
  await expect(page.getByTestId('branch-popover')).toHaveAttribute('data-mode', 'lenses')
}

test.beforeEach(async ({ page }) => {
  // Static-site mock only: never reach a real provider from UI tests.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname !== '127.0.0.1') return route.abort()
    return route.continue()
  })
  await page.goto('/')
  await page.getByTestId('show-demo').click()
  await expect(page.locator('[data-message-id="msg-root-4"]')).toBeAttached()
})

test('a lens grows a branch from whole words and opens it beside its source', async ({ page }, testInfo) => {
  // "ghlight text in any me" — both ends cut words.
  await select(page, 'msg-root-4', 2, 22)
  await page.locator('[data-lens="explain"]').click()

  const branch = page.getByTestId('branch-lane')
  await expect(branch).toBeVisible()
  await expect(branch.locator('article').first()).toContainText('Explain “Highlight text in any message”')
  await expect(branch.getByTestId('reply-progress')).toHaveCount(0, { timeout: 10_000 })
  const created = Object.values((await tree(page)).threads).find((thread) => thread.anchor?.quote === 'Highlight text in any message')
  expect(created).toBeDefined()

  if (testInfo.project.use.isMobile) {
    // One lane at a time on phones; the back arrow returns to the passage.
    await expect(page.getByTestId('main-lane')).toHaveCount(0)
    await page.getByTestId('back-to-spine').click()
    await expect(page.getByTestId('branch-lane')).toHaveCount(0)
    await expect(page.getByTestId('main-lane')).toBeVisible()
    return
  }
  await expect(page.getByTestId('main-lane')).toBeVisible()
  await expect(page.locator(`[data-connector-for="${created!.id}"]`)).toBeAttached()
  // A lens leaves focus where it was, so reading carries on while it answers;
  // the branch has its own composer and the main one still posts to the main thread.
  await expect(branch.getByRole('textbox', { name: /^Message to Explain/ })).toBeVisible()
  await expect(branch.getByRole('textbox', { name: /^Message to Explain/ })).not.toBeFocused()
  await expect(page.getByTestId('main-lane').getByRole('textbox', { name: 'Message to Main conversation' })).toBeVisible()

  // Clicking the open branch's link closes its lane again.
  await page.getByRole('button', { name: /^Close branch: Explain/ }).click()
  await expect(page.getByTestId('branch-lane')).toHaveCount(0)
})

test('typing with a passage selected asks about it in place', async ({ page }) => {
  await select(page, 'msg-root-4', 0, 45)
  await page.keyboard.type('W')
  const popover = page.getByTestId('branch-popover')
  await expect(popover).toHaveAttribute('data-mode', 'ask')
  await expect(page.getByLabel('Your branch question')).toBeFocused()
  await expect(page.getByLabel('Your branch question')).toHaveValue('W')
  await page.keyboard.type('hy does this matter?')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('branch-lane').locator('article').first()).toContainText('Why does this matter?')
  await expect(page.getByTestId('branch-popover')).toHaveCount(0)
})

test('Escape cancels an unsent question without creating a branch', async ({ page }) => {
  const before = Object.keys((await tree(page)).threads)
  await select(page, 'msg-root-4', 0, 20)
  await page.getByTestId('branch-chip').click()
  await page.getByLabel('Your branch question').fill('Never mind')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('branch-popover')).toHaveCount(0)
  expect(Object.keys((await tree(page)).threads)).toEqual(before)
})

test('ancestors that no longer fit fold into strips that expand again', async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'phones show one lane at a time')
  await page.locator('button[aria-label^="Open branch"]').first().click()
  const first = page.getByTestId('branch-lane')
  await expect(first).toHaveCount(1)
  const nested = first.locator('button[aria-label^="Open branch"]').first()
  await nested.click()
  await expect(page.getByTestId('branch-lane')).toHaveCount(2)
  const strip = page.getByTestId('lane-strip')
  await expect(strip).toHaveCount(1)
  await expect(page.getByTestId('main-lane')).toHaveCount(0)
  await strip.click()
  await expect(page.getByTestId('main-lane')).toBeVisible()
  await expect(page.getByTestId('branch-lane')).toHaveCount(2)
})

test('a short branch starts level with its passage', async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'phones show one lane at a time')
  await page.locator('button[aria-label^="Open branch"]').first().click()
  await expect(page.getByTestId('branch-anchor')).toBeVisible()
  await expect.poll(async () => page.evaluate(() => {
    const anchor = document.querySelector('[data-lane-anchor]')!.getBoundingClientRect()
    // A wrapped passage lines up by its first line, where the connector starts.
    const passage = document.querySelector('[data-testid="main-lane"] mark[data-open="true"]')!.getClientRects()[0]!
    return Math.abs((anchor.top + anchor.height / 2) - (passage.top + passage.height / 2))
  }), { timeout: 10_000 }).toBeLessThan(12)
})

test('panes collapse to strips, expand again, and resize from the gutter', async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'phones show one lane at a time')
  await page.locator('button[aria-label^="Open branch"]').first().click()
  const branch = page.getByTestId('branch-lane')
  await expect(branch).toBeVisible()

  const resizer = page.getByTestId('lane-resizer')
  const before = (await branch.boundingBox())!.width
  await resizer.focus()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await branch.boundingBox())!.width).toBeGreaterThan(before + 50)
  const box = (await resizer.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 200)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + 200, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await branch.boundingBox())!.width).toBeLessThan(before)
  await resizer.dblclick()
  await expect.poll(async () => Math.round((await branch.boundingBox())!.width)).toBe(460)

  // Collapsing lives in each lane's ⋯ menu.
  await page.getByTestId('chat-menu').click()
  await page.getByTestId('collapse-lane').click()
  await expect(page.getByTestId('main-lane')).toHaveCount(0)
  await expect(page.getByTestId('lane-strip')).toHaveCount(1)
  await page.getByTestId('lane-strip').click()
  await expect(page.getByTestId('main-lane')).toBeVisible()
  await expect(page.getByTestId('lane-strip')).toHaveCount(0)
})

test('the sidebar holds New chat and Settings, collapses, resizes, and remembers', async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'phones have no sidebar')
  const sidebar = page.getByTestId('chat-sidebar')
  await expect(sidebar.getByTestId('new-chat')).toBeVisible()
  await expect(sidebar.getByTestId('settings-button')).toBeVisible()
  await expect(page.locator('header').getByTestId('new-chat')).toHaveCount(0)
  await expect(page.getByText(/Live ·/)).toHaveCount(0)

  const before = (await sidebar.boundingBox())!.width
  const handle = (await page.getByTestId('sidebar-resizer').boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 300)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2 + 80, handle.y + 300, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(Math.round(before + 80))

  await page.keyboard.press('ControlOrMeta+Backslash')
  await expect(sidebar).toHaveAttribute('data-collapsed', 'true')
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeLessThan(60)
  await page.reload()
  await expect(page.getByTestId('chat-sidebar')).toHaveAttribute('data-collapsed', 'true')
  await page.getByTestId('sidebar-toggle').click()
  await expect(page.getByTestId('chat-sidebar')).toHaveAttribute('data-collapsed', 'false')
  await expect.poll(async () => Math.round((await page.getByTestId('chat-sidebar').boundingBox())!.width)).toBe(Math.round(before + 80))
})

test('a branch whose passage scrolled away points back to it instead of drawing across the screen', async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'phones show one lane at a time')
  await page.setViewportSize({ width: 1280, height: 520 })
  await select(page, 'msg-root-2', 0, 20)
  await page.locator('[data-lens="explain"]').click()
  await expect(page.getByTestId('branch-lane')).toBeVisible()
  await expect(page.getByTestId('lane-jump')).toHaveCount(0)

  // Scroll the main lane until the passage is gone below the fold.
  await page.getByTestId('main-lane').locator('[data-radix-scroll-area-viewport]').evaluate((viewport) => {
    viewport.scrollTop = viewport.scrollHeight
  })
  const jump = page.getByTestId('lane-jump')
  await expect(jump).toBeVisible()
  await expect(jump).toContainText('Passage')
  await jump.click()
  await expect(jump).toHaveCount(0)
  await expect(page.locator('[data-message-id="msg-root-2"] mark[data-open="true"]').first()).toBeInViewport()
})

test('a branch keeps answering after its lane is closed, and after switching chats', async ({ page }) => {
  const branchReply = async (quote: string) => {
    const library = await savedLibrary(page)
    for (const session of library.sessions) {
      const branch = Object.values(session.treeState.threads).find((thread) => thread.anchor?.quote === quote)
      if (branch) return branch.messages.find((message) => message.role === 'assistant')?.content ?? ''
    }
    return ''
  }
  // The demo reply for a lens ends with this sentence.
  const complete = /before adding it\.$/

  // Close the branch as soon as its reply starts streaming.
  await select(page, 'msg-root-4', 0, 29)
  await page.locator('[data-lens="explain"]').click()
  await expect.poll(() => branchReply('Highlight text in any message')).not.toBe('')
  expect(await branchReply('Highlight text in any message')).not.toMatch(complete)
  await page.getByTestId('back-to-spine').click()
  await expect(page.getByTestId('branch-lane')).toHaveCount(0)
  await expect.poll(() => branchReply('Highlight text in any message'), { timeout: 15_000 }).toMatch(complete)

  // Start another, then leave the chat while it answers.
  await select(page, 'msg-root-2', 0, 23)
  await page.locator('[data-lens="explain"]').click()
  await expect.poll(() => branchReply('TreeChat is a branching')).not.toBe('')
  await page.getByTestId('new-chat').click()
  await expect(page.getByTestId('empty-chat-guide')).toBeVisible()
  await expect.poll(() => branchReply('TreeChat is a branching'), { timeout: 15_000 }).toMatch(complete)
})
