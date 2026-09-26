import { expect, test, type Page } from './fixtures'
import { tree } from './library'
import type { Thread } from '../../src/types'

/**
 * Select `text` inside a message by visible-text position, across element
 * boundaries (chips), skipping offset-ignored chrome like the chip tooltip.
 */
async function selectText(page: Page, messageSelector: string, text: string) {
  const message = page.locator(messageSelector)
  await message.scrollIntoViewIfNeeded()
  // A finishing reply re-renders once more (its sources attach), which can
  // replace the text nodes under a selection made in that instant: retry.
  await expect(async () => {
    await message.evaluate((element, text) => {
      const nodes: Text[] = []
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => node.parentElement?.closest('[data-offset-ignore]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
      })
      for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text)
      const plain = nodes.map((node) => node.data).join('')
      const start = plain.indexOf(text)
      if (start < 0) throw new Error(`"${text}" not in message`)
      const locate = (offset: number) => {
        for (const node of nodes) {
          if (offset <= node.data.length) return { node, offset }
          offset -= node.data.length
        }
        throw new Error('offset out of range')
      }
      const from = locate(start)
      const to = locate(start + text.length)
      const range = document.createRange()
      range.setStart(from.node, from.offset)
      range.setEnd(to.node, to.offset)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    }, text)
    await expect(page.getByTestId('branch-popover')).toHaveAttribute('data-mode', 'lenses', { timeout: 1500 })
  }).toPass({ timeout: 10_000 })
}

const READER_PAGE = `Title: Branching conversations keep tangents in place
URL Source: https://example.com/branching-conversations

Markdown Content:
# Branching conversations

Some preamble that pushes the passage down the page.

${'Filler paragraph about reading long pages. '.repeat(40)}

In practice, a branch
stays attached to the passage that prompted it, which is the whole point.

${'More filler after the passage. '.repeat(20)}`

test.beforeEach(async ({ page }) => {
  // Static-site mock only: never reach a real provider or reader from UI tests.
  await page.goto('/')
  await page.getByTestId('show-demo').click()
  await expect(page.locator('[data-message-id="msg-root-4"]')).toBeAttached()
})

/** Source? on a passage: a branch that searches the web and cites its reply. */
async function askForSource(page: Page) {
  await selectText(page, '[data-message-id="msg-root-4"]', 'Highlight text in any message')
  await page.locator('[data-lens="source"]').click()
  const branch = page.getByTestId('branch-lane')
  await expect(branch).toBeVisible()
  await expect(branch.getByTestId('reply-progress')).toHaveCount(0, { timeout: 10_000 })
  await expect(branch.getByTestId('sources-list')).toBeVisible({ timeout: 10_000 })
  return branch
}

async function citedBranch(page: Page): Promise<Thread> {
  const find = async () => Object.values((await tree(page)).threads).find((thread) => thread.anchor?.quote === 'Highlight text in any message')
  // Sources are saved with the reply once it finishes.
  await expect.poll(async () => (await find())?.messages.at(-1)?.citations?.length ?? 0).toBeGreaterThan(0)
  return (await find())!
}

test('Source? searches the web, cites the reply, and opens a source beside it', async ({ page }, testInfo) => {
  const readerRequests: string[] = []
  await page.route('https://r.jina.ai/**', (route) => {
    readerRequests.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: READER_PAGE })
  })
  const branch = await askForSource(page)

  await expect(branch.getByTestId('web-search-toggle')).toHaveAttribute('aria-pressed', 'true')
  const chip = branch.getByRole('button', { name: 'Source 1: Branching conversations keep tangents in place' })
  await expect(chip).toBeVisible()
  await expect(branch.getByRole('button', { name: /^Source 2: Bringing takeaways back/ })).toBeVisible()
  await expect(branch.getByTestId('source-entry')).toHaveCount(2)
  await expect(branch.getByTestId('source-entry').first()).toContainText('example.com')

  // Persisted: the branch keeps web search, the reply keeps its sources.
  await expect.poll(async () => (await citedBranch(page))?.messages.at(-1)?.citations?.map((citation) => citation.id)).toEqual(['1', '2'])
  const created = await citedBranch(page)
  expect(created.webSearch).toBe(true)
  expect(created.messages.at(-1)!.citations![0]!.url).toBe('https://example.com/branching-conversations')

  await chip.click()
  const lane = page.getByTestId('source-lane')
  await expect(lane).toBeVisible()
  await expect(lane.getByTestId('source-title')).toHaveText('Branching conversations keep tangents in place')
  await expect(lane.getByTestId('source-original')).toHaveAttribute('href', 'https://example.com/branching-conversations')
  await expect(lane.getByTestId('source-content')).toHaveAttribute('data-snippet', 'found')
  await expect(lane.getByRole('heading', { name: 'Branching conversations' })).toBeAttached()
  expect(readerRequests).toEqual(['https://r.jina.ai/https://example.com/branching-conversations'])
  const highlighted = await page.evaluate(() => [...(CSS.highlights.get('source-snippet') ?? [])].map((range) => range.toString().replace(/\s+/g, ' ')))
  // Matched across a line break and a case difference.
  expect(highlighted).toEqual(['a branch stays attached to the passage that prompted it'])
  await expect(lane.getByTestId('source-content').getByText(/stays attached to the passage/)).toBeInViewport()

  if (testInfo.project.use.isMobile) {
    // The source replaces the view; Back returns to the branch.
    await expect(page.getByTestId('branch-lane')).toHaveCount(0)
    await lane.getByRole('button', { name: 'Back to conversation' }).click()
    await expect(page.getByTestId('source-lane')).toHaveCount(0)
    await expect(page.getByTestId('branch-lane')).toBeVisible()
  } else {
    await expect(branch).toBeVisible()
    await expect(chip).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('[data-connector-for="source-lane"]')).toBeAttached()
    await lane.getByRole('button', { name: 'Close source' }).click()
    await expect(page.getByTestId('source-lane')).toHaveCount(0)
    await expect(chip).toBeFocused()
  }

  // The sources list opens a source too; Esc closes it and nothing else.
  await branch.getByTestId('source-entry').nth(1).click()
  await expect(page.getByTestId('source-lane').getByTestId('source-title')).toHaveText('Bringing takeaways back')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('source-lane')).toHaveCount(0)
  await expect(page.getByTestId('branch-lane')).toBeVisible()

  // The reader can switch web search off for this branch.
  await branch.getByTestId('web-search-toggle').click()
  await expect(branch.getByTestId('web-search-toggle')).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(async () => (await citedBranch(page)).webSearch).toBeUndefined()
})

test('with a key, Source? asks OpenRouter to search and renders its URL citations', async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'one live-transport check is enough')
  await page.evaluate(() => localStorage.setItem('treechat:provider:v1', JSON.stringify({ provider: 'openrouter', apiKey: 'test-only-never-sent', model: 'test-model' })))
  const requests: Array<Record<string, unknown>> = []
  const cite = (url: string, title: string, content: string) => ({ type: 'url_citation', url_citation: { url, title, content, start_index: 0, end_index: 1 } })
  const events = [
    { choices: [{ delta: { content: 'Selecting text starts a branch [1]' } }] },
    { choices: [{ delta: { content: ', and the passage stays marked [2].', annotations: [cite('https://example.com/select', 'Selecting passages', 'Select any text to branch from it')] } }] },
    { choices: [{ delta: {}, finish_reason: 'stop', message: { role: 'assistant', annotations: [
      cite('https://example.com/select', 'Selecting passages', 'Select any text to branch from it'),
      cite('https://example.org/marks', 'Passage marks', 'The passage stays underlined'),
    ] } }] },
  ]
  await page.route('https://openrouter.ai/**', (route) => {
    requests.push(route.request().postDataJSON())
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' },
      body: [...events.map((event) => `data: ${JSON.stringify(event)}\n\n`), 'data: [DONE]\n\n'].join(''),
    })
  })
  await page.reload()

  const branch = await askForSource(page)
  expect(requests).toHaveLength(1)
  expect(requests[0]!.plugins).toEqual([expect.objectContaining({ id: 'web', max_results: 5, search_prompt: expect.stringContaining('[1]') })])
  await expect(branch.getByRole('button', { name: 'Source 1: Selecting passages' })).toBeVisible()
  await expect(branch.getByRole('button', { name: 'Source 2: Passage marks' })).toBeVisible()
  await expect(branch.getByTestId('source-entry')).toHaveCount(2)
  await expect(branch.getByTestId('source-entry').nth(1)).toContainText('example.org')

  // An ordinary reply in the same chat never searches.
  await branch.getByTestId('web-search-toggle').click()
  await branch.getByTestId('thread-composer').fill('Thanks')
  await branch.getByTestId('thread-composer').press('Enter')
  await expect.poll(() => requests.length).toBe(2)
  expect(requests[1]!.plugins).toBeUndefined()
})

test('a source the reader cannot load falls back to its title, snippet and link', async ({ page }) => {
  await page.route('https://r.jina.ai/**', (route) => route.abort('failed'))
  const branch = await askForSource(page)
  await branch.getByRole('button', { name: /^Source 2: / }).click()
  const lane = page.getByTestId('source-lane')
  await expect(lane.getByTestId('source-fallback')).toBeVisible()
  await expect(lane.getByTestId('source-fallback')).toContainText('could not be loaded')
  await expect(lane.getByTestId('source-anchor')).toContainText('a short takeaway returns to the main conversation')
  await expect(lane.getByTestId('source-title')).toHaveText('Bringing takeaways back')
  await expect(lane.getByTestId('source-fallback').getByRole('link', { name: 'Open original' })).toHaveAttribute('href', 'https://example.com/takeaways')
})

test('a cited paragraph still branches from exactly the selected words', async ({ page }) => {
  await page.route('https://r.jina.ai/**', (route) => route.abort('failed'))
  const branch = await askForSource(page)
  const reply = (await citedBranch(page)).messages.at(-1)!
  const passage = 'the main thread away [1]. When the branch'
  await selectText(page, `[data-testid="branch-lane"] [data-message-id="${reply.id}"]`, passage)
  await page.locator('[data-lens="explain"]').click()

  await expect.poll(async () => Object.values((await tree(page)).threads).find((thread) => thread.anchor?.messageId === reply.id)?.anchor).toMatchObject({
    quote: passage,
    start: reply.content.indexOf(passage),
    end: reply.content.indexOf(passage) + passage.length,
  })
  const child = Object.values((await tree(page)).threads).find((thread) => thread.anchor?.messageId === reply.id)!
  // The passage is marked in the cited reply, and its chip still works.
  await page.getByRole('button', { name: /^Back to passage/ }).last().click()
  const mark = branch.locator(`mark[data-mark-ids~="${child.id}"]`)
  await expect(mark.first()).toBeAttached()
  const markedText = await branch.locator(`[data-message-id="${reply.id}"]`).evaluate((element, id) =>
    [...element.querySelectorAll(`mark[data-mark-ids~="${id}"]`)].map((mark) => mark.textContent).join(''), child.id)
  expect(markedText).toBe(passage)
  await expect(branch.getByRole('button', { name: /^Source 1: / })).toBeVisible()
})
