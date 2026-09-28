import { expect, test, type Page } from './fixtures'
import { tree } from './library'
import { restoreDemo, selectText } from './helpers'
import type { Thread } from '../../src/types'

const READER_PAGE = `Title: Branching conversations keep tangents in place
URL Source: https://example.com/branching-conversations

Markdown Content:
# Branching conversations

${'Filler about reading long pages. '.repeat(20)}

In practice, a branch stays attached to the passage that prompted it, which is the whole point.

Tangents that wander off are easier to follow when they sit beside their source.`

const NOTES = [
  '# Atmosphere notes',
  '',
  'Clear-sky colour depends on the path of the light. Near twilight, ozone absorbs part of the orange and red light, which keeps the zenith blue.',
  '',
  'Skylight 90 degrees from the sun is strongly polarised.',
].join('\n')

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('treechat:fake-embedder', '1'))
  await page.goto('/')
})

const branchWith = async (page: Page, predicate: (thread: Thread) => boolean) => Object.values((await tree(page)).threads).find(predicate)

/** Type a question into the open question box and send it. */
async function ask(page: Page, question: string) {
  const box = page.getByLabel('Your branch question')
  await box.fill(question)
  await box.press('Enter')
}

test('a passage of a cited page branches like message text, with the page around it as context', async ({ page }) => {
  await page.route('https://r.jina.ai/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: READER_PAGE }))
  await restoreDemo(page)
  await selectText(page, '[data-message-id="msg-root-4"]', 'Highlight text in any message')
  await page.locator('[data-lens="source"]').click()
  const branch = page.getByTestId('branch-lane')
  await expect(branch.getByTestId('sources-list')).toBeVisible({ timeout: 15_000 })
  await branch.getByRole('button', { name: 'Source 1: Branching conversations keep tangents in place' }).click()
  const lane = page.getByTestId('source-lane')
  await expect(lane.getByTestId('source-content')).toContainText('Tangents that wander off')

  await selectText(page, '[data-testid="source-content"]', 'easier to follow when they sit beside their source')
  await page.getByTestId('branch-chip').click()
  await ask(page, 'Why is that easier?')

  await expect.poll(async () => (await branchWith(page, (thread) => thread.anchor?.quote === 'easier to follow when they sit beside their source'))?.messages.length ?? 0, { timeout: 15_000 }).toBeGreaterThan(1)
  const grown = (await branchWith(page, (thread) => thread.anchor?.quote === 'easier to follow when they sit beside their source'))!
  expect(grown.anchor!.source).toMatchObject({ kind: 'web', title: 'Branching conversations keep tangents in place', url: 'https://example.com/branching-conversations', citationId: '1' })
  expect(grown.anchor!.source!.context).toContain('Tangents that wander off are easier to follow')
  expect(grown.anchor!.source!.context!.length).toBeLessThan(1400)
  const cited = (await tree(page)).threads[grown.parentId!]!
  expect(cited.messages.some((message) => message.id === grown.anchor!.messageId && message.citations?.length)).toBe(true)
  await expect(page.getByTestId('anchor-label').last()).toHaveText('From Branching conversations keep tangents in place')
  await expect(page.getByTestId('branch-anchor').last()).toContainText('easier to follow when they sit beside their source')

  // Back in the citing branch, the passage is marked at its citation, and in the page itself.
  await page.getByTestId('back-to-spine').last().click()
  await expect(page.getByTestId('branch-lane').getByTestId('margin-branch')).toHaveCount(1)
  await page.getByTestId('branch-lane').getByRole('button', { name: 'Source 1: Branching conversations keep tangents in place' }).click()
  await expect(page.getByTestId('source-lane').getByTestId('source-branch')).toHaveCount(1)
})

test('a document from the sidebar opens beside the chat, and its text branches', async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'phones have no sidebar')
  await restoreDemo(page)
  await page.getByTestId('documents-section').getByTestId('documents-file-input').setInputFiles({
    name: 'atmosphere-notes.md', mimeType: 'text/markdown', buffer: Buffer.from(NOTES),
  })
  const open = page.getByTestId('document-open')
  await expect(open).toHaveText('atmosphere-notes.md', { timeout: 15_000 })
  await open.click()
  const lane = page.getByTestId('source-lane')
  await expect(lane.getByTestId('source-title')).toHaveText('atmosphere-notes.md')
  await expect(lane.getByTestId('source-content')).toContainText('ozone absorbs part of the orange and red light')

  await selectText(page, '[data-testid="source-content"]', 'ozone absorbs part of the orange and red light')
  await page.locator('[data-lens="explain"]').click()
  await expect(page.getByTestId('source-lane')).toHaveCount(0)
  await expect(page.getByTestId('anchor-label')).toHaveText('From atmosphere-notes.md')
  await expect.poll(async () => (await branchWith(page, (thread) => Boolean(thread.anchor?.source)))?.anchor?.source).toMatchObject({
    kind: 'document', title: 'atmosphere-notes.md', context: expect.stringContaining('Near twilight, ozone absorbs'),
  })
  const grown = (await branchWith(page, (thread) => Boolean(thread.anchor?.source)))!
  expect(grown.parentId).toBe('thread-root')
  expect(grown.anchor!.messageId).toBe('msg-root-6')
  // Not an underline in the message it hangs off.
  await expect(page.locator(`[data-mark-ids~="${grown.id}"]`)).toHaveCount(0)

  // Opening the document again shows where branches grew.
  await page.getByTestId('back-to-spine').click()
  await page.getByTestId('document-open').click()
  await expect(page.getByTestId('source-lane').getByTestId('source-branch')).toHaveCount(1)
  await page.getByTestId('source-lane').getByTestId('source-branch').click()
  await expect(page.getByTestId('anchor-label')).toHaveText('From atmosphere-notes.md')
})

/** Paste a 1200×600 image, left half red and right half blue, and send it with a question. */
async function sendImage(page: Page) {
  await page.getByTestId('thread-composer').evaluate(async (target) => {
    const canvas = document.createElement('canvas')
    canvas.width = 1200
    canvas.height = 600
    const context = canvas.getContext('2d')!
    context.fillStyle = '#c33'
    context.fillRect(0, 0, 600, 600)
    context.fillStyle = '#33c'
    context.fillRect(600, 0, 600, 600)
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'))
    const data = new DataTransfer()
    data.items.add(new File([blob], 'chart.png', { type: 'image/png' }))
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
    if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data })
    target.dispatchEvent(event)
  })
  await expect(page.getByTestId('composer-attachments').locator('[data-attachment-id]')).toHaveCount(1)
  await page.getByTestId('thread-composer').fill('What does this chart show?')
  await page.getByTestId('thread-composer').press('Enter')
  await expect(page.getByTestId('composer-stop')).toHaveCount(0, { timeout: 15_000 })
}

test('a region of an image branches: the crop is sent and shown as the anchor', async ({ page }, testInfo) => {
  await sendImage(page)
  await page.getByTestId('select-region').click()
  const picker = page.getByTestId('region-picker')
  const box = (await picker.boundingBox())!
  // The right (blue) half, by pointer, or by touch on phones.
  const from = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.2 }
  const to = { x: box.x + box.width * 0.95, y: box.y + box.height * 0.8 }
  if (testInfo.project.use.isMobile) {
    await picker.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: from.x, clientY: from.y, isPrimary: true, button: 0 })
    await picker.dispatchEvent('pointermove', { pointerId: 1, pointerType: 'touch', clientX: to.x, clientY: to.y, isPrimary: true })
    await picker.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', clientX: to.x, clientY: to.y, isPrimary: true, button: 0 })
  } else {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 4 })
    await page.mouse.up()
  }
  await expect(page.getByTestId('branch-popover')).toHaveAttribute('data-mode', 'ask')
  await ask(page, 'What is this blue part?')

  // The demo cannot see images; it names what it was sent: the crop, not the whole image.
  const lane = page.getByTestId('branch-lane')
  await expect(lane.locator('article').last()).toContainText('I received 1 image (Region of chart.png', { timeout: 15_000 })
  await expect(lane.getByTestId('anchor-label')).toHaveText('From chart.png')
  await expect(lane.getByTestId('branch-anchor').locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/)
  const grown = (await branchWith(page, (thread) => Boolean(thread.anchor?.region)))!
  const region = grown.anchor!.region!
  expect(region.name).toBe('chart.png')
  expect(region.x).toBeGreaterThan(0.55)
  expect(region.w).toBeGreaterThan(0.3)
  expect(region.crop).toMatchObject({ kind: 'image', mime: 'image/png' })
  // The crop is blue: only the right half was taken.
  const pixel = await lane.getByTestId('branch-anchor').locator('img').evaluate(async (img: HTMLImageElement) => {
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const context = canvas.getContext('2d')!
    context.drawImage(img, 0, 0)
    return [...context.getImageData(1, 1, 1, 1).data]
  })
  expect(pixel[2]).toBeGreaterThan(150)
  expect(pixel[0]).toBeLessThan(100)

  // A marker on the image opens the branch again.
  await page.getByTestId('back-to-spine').click()
  await expect(page.getByTestId('region-branch')).toHaveCount(1)
  await page.getByTestId('region-branch').click()
  await expect(page.getByTestId('branch-lane').getByTestId('anchor-label')).toHaveText('From chart.png')
})

test('your own question can be branched from', async ({ page }) => {
  await restoreDemo(page)
  await selectText(page, '[data-message-id="msg-root-3"]', 'actually start a branch')
  await page.locator('[data-lens="simpler"]').click()
  await expect(page.getByTestId('branch-anchor')).toContainText('actually start a branch')
  await expect.poll(async () => (await branchWith(page, (thread) => thread.anchor?.messageId === 'msg-root-3'))?.messages.length ?? 0, { timeout: 15_000 }).toBeGreaterThan(1)
  await page.getByTestId('back-to-spine').click()
  await expect(page.locator('[data-message-id="msg-root-3"] [data-mark-ids]')).toHaveCount(1)
})
