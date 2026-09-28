import { expect, test } from './fixtures'
import { tree } from './library'
import { restoreDemo, selectText } from './helpers'

const ORIGINAL = 'Every lane has its own composer'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

const lastReply = (page: import('./fixtures').Page) => page.locator('[data-thread-id="thread-root"][data-message-id]').last()
const rootMessages = async (page: import('./fixtures').Page) => (await tree(page)).threads['thread-root']!.messages

test('regenerate keeps the earlier answer, and the pager switches between them', async ({ page }) => {
  await restoreDemo(page)
  await page.getByTestId('message-retry').last().click({ force: true })
  const pager = page.getByTestId('answer-pager')
  await expect(pager.getByTestId('answer-position')).toHaveText('2 of 2', { timeout: 15_000 })
  await expect(page.getByTestId('composer-stop')).toHaveCount(0)
  await expect(lastReply(page)).not.toContainText(ORIGINAL)

  await pager.getByRole('button', { name: 'Previous answer' }).click()
  await expect(pager.getByTestId('answer-position')).toHaveText('1 of 2')
  await expect(lastReply(page)).toContainText(ORIGINAL)
  await expect.poll(async () => (await rootMessages(page)).at(-1)).toMatchObject({ content: expect.stringContaining(ORIGINAL), answerIndex: 0 })
  const saved = (await rootMessages(page)).at(-1)!
  expect(saved.alternates).toHaveLength(1)

  // Reloading keeps both, showing the chosen one.
  await page.reload()
  await expect(page.getByTestId('answer-position')).toHaveText('1 of 2')
  await page.getByTestId('answer-pager').getByRole('button', { name: 'Next answer' }).click()
  await expect(lastReply(page)).not.toContainText(ORIGINAL)
})

test('Try another model answers once with the chosen model; Settings keep theirs', async ({ page }) => {
  await restoreDemo(page)
  await page.getByTestId('try-model').last().click({ force: true })
  await expect(page.getByRole('menuitem', { name: 'GPT-5.6 Luna' })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'Claude Sonnet 5' }).click()
  await expect(lastReply(page)).toContainText('Demo answer standing in for anthropic/claude-sonnet-5.', { timeout: 15_000 })
  await expect(page.getByTestId('answer-position')).toHaveText('2 of 2 · Claude Sonnet 5')
  await expect.poll(async () => (await rootMessages(page)).at(-1)?.model).toBe('anthropic/claude-sonnet-5')
  expect(await page.evaluate(() => localStorage.getItem('treechat:provider:v1'))).toBeNull()

  // The next request is the Settings model again.
  await page.getByTestId('message-retry').last().click({ force: true })
  await expect(page.getByTestId('answer-position')).toHaveText('3 of 3', { timeout: 15_000 })
  await expect(lastReply(page)).not.toContainText('Demo answer standing in')

  // Any model by id, through Other….
  await expect(page.getByTestId('composer-stop')).toHaveCount(0)
  await page.getByTestId('try-model').last().click({ force: true })
  await page.getByRole('menuitem', { name: 'Other…' }).click()
  const dialog = page.getByTestId('try-model-other')
  await dialog.getByTestId('try-model-picker').click()
  await dialog.getByRole('combobox').fill('mistralai/mistral-large')
  await dialog.getByRole('combobox').press('Enter')
  await dialog.getByRole('button', { name: 'Answer' }).click()
  await expect(lastReply(page)).toContainText('Demo answer standing in for mistralai/mistral-large.', { timeout: 15_000 })
  await expect(page.getByTestId('answer-position')).toHaveText(/^4 of 4 · /)
})

test('with a key, the chosen model goes in the request, and only that one', async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'request shape is covered on desktop')
  await page.evaluate(() => localStorage.setItem('treechat:provider:v1', JSON.stringify({ provider: 'openrouter', apiKey: 'test-key', model: 'openai/gpt-5.6-luna' })))
  await page.reload()
  const models: string[] = []
  const sent: string[] = []
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    const body = route.request().postDataJSON() as { model: string; messages: Array<{ content: unknown }> }
    models.push(body.model)
    sent.push(JSON.stringify(body.messages))
    const chunks = [{ choices: [{ delta: { content: `Answer from ${body.model}` } }] }, { model: body.model, usage: { prompt_tokens: 3, completion_tokens: 4, cost: 0.0001 }, choices: [] }]
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n' })
  })
  await page.route('https://openrouter.ai/api/v1/models*', (route) => route.fulfill({ status: 200, body: JSON.stringify({ data: [] }) }))
  await restoreDemo(page)
  await page.getByTestId('try-model').last().click({ force: true })
  await page.getByRole('menuitem', { name: 'Grok 4.7' }).click()
  await expect(lastReply(page)).toHaveText('Answer from x-ai/grok-4.7', { timeout: 15_000 })
  await expect(page.getByTestId('answer-position')).toHaveText(/^2 of 2 · /)
  await expect(page.getByTestId('composer-stop')).toHaveCount(0)
  await page.getByTestId('thread-composer').fill('And then?')
  await page.getByTestId('thread-composer').press('Enter')
  await expect(lastReply(page)).toHaveText('Answer from openai/gpt-5.6-luna', { timeout: 15_000 })
  expect(models).toEqual(['x-ai/grok-4.7', 'openai/gpt-5.6-luna'])
  // Only the current answer is sent as history.
  expect(sent[1]).toContain('Answer from x-ai/grok-4.7')
  expect(sent[1]).not.toContain(ORIGINAL)
})

test('an answer with branches, or an older reply, cannot be switched away from', async ({ page }) => {
  await restoreDemo(page)
  await page.getByTestId('message-retry').last().click({ force: true })
  const pager = page.getByTestId('answer-pager')
  await expect(pager.getByTestId('answer-position')).toHaveText('2 of 2', { timeout: 15_000 })
  await expect(page.getByTestId('composer-stop')).toHaveCount(0)
  await pager.getByRole('button', { name: 'Previous answer' }).click()
  await expect(pager.getByTestId('answer-position')).toHaveText('1 of 2')

  // Branch from this answer: it now stays.
  const id = (await rootMessages(page)).at(-1)!.id
  await selectText(page, `[data-thread-id="thread-root"][data-message-id="${id}"]`, 'Every lane has its own composer')
  await page.locator('[data-lens="simpler"]').click()
  await expect(page.getByTestId('composer-stop')).toHaveCount(0, { timeout: 15_000 })
  await page.getByTestId('back-to-spine').click()
  await expect(pager.getByRole('button', { name: 'Next answer' })).toBeDisabled()
  await expect(pager).toHaveAttribute('title', 'This answer has branches, so it stays')
})

test('only the latest reply can switch', async ({ page }) => {
  await restoreDemo(page)
  await page.getByTestId('message-retry').last().click({ force: true })
  await expect(page.getByTestId('answer-position')).toHaveText('2 of 2', { timeout: 15_000 })
  await expect(page.getByTestId('composer-stop')).toHaveCount(0)
  await page.getByTestId('thread-composer').fill('One more question')
  await page.getByTestId('thread-composer').press('Enter')
  await expect(page.getByTestId('composer-stop')).toHaveCount(0, { timeout: 15_000 })
  await expect.poll(async () => (await rootMessages(page)).length).toBe(8)
  const pager = page.getByTestId('answer-pager')
  await expect(pager.getByRole('button', { name: 'Previous answer' })).toBeDisabled()
  await expect(pager).toHaveAttribute('title', 'Only the latest reply can switch answers')
})

test('answers kept by a failed regenerate do not end up on the next reply', async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'the queue is the same on phones')
  await page.evaluate(() => localStorage.setItem('treechat:provider:v1', JSON.stringify({ provider: 'openrouter', apiKey: 'test-key', model: 'openai/gpt-5.6-luna' })))
  await page.reload()
  let calls = 0
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    calls += 1
    if (calls === 1) return route.fulfill({ status: 500, body: JSON.stringify({ error: { message: 'Upstream is down' } }) })
    const body = `data: ${JSON.stringify({ choices: [{ delta: { content: 'A fresh reply' } }] })}\n\ndata: [DONE]\n\n`
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body })
  })
  await restoreDemo(page)
  await page.getByTestId('message-retry').last().click({ force: true })
  await expect(page.getByRole('alert')).toContainText('Upstream is down')
  await page.getByTestId('thread-composer').fill('Something else entirely')
  await page.getByTestId('thread-composer').press('Enter')
  await expect(lastReply(page)).toHaveText('A fresh reply', { timeout: 15_000 })
  await expect(page.getByTestId('answer-pager')).toHaveCount(0)
  await expect.poll(async () => (await rootMessages(page)).at(-1)?.content).toBe('A fresh reply')
  expect((await rootMessages(page)).at(-1)!.alternates).toBeUndefined()
})
