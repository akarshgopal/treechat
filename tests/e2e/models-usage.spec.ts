import { expect, test, type Page } from '@playwright/test'

const MODELS = { data: [
  { id: 'openai/gpt-4.1-mini', name: 'OpenAI: GPT-4.1 Mini', context_length: 1047576, pricing: { prompt: '0.0000004', completion: '0.0000016' }, architecture: { input_modalities: ['text', 'image'] } },
  { id: 'anthropic/claude-sonnet-5', name: 'Anthropic: Claude Sonnet 5', context_length: 200000, pricing: { prompt: '0.000003', completion: '0.000015' }, architecture: { input_modalities: ['text', 'image'] } },
  { id: 'google/gemma-4-31b-it:free', name: 'Google: Gemma 4 31B (free)', context_length: 131072, pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'] } },
] }

async function mockOpenRouter(page: Page) {
  // Static-site mock only: never reach a real provider from UI tests.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/status') return route.fulfill({ status: 404, body: 'Static mock' })
    if (url.href === 'https://openrouter.ai/api/v1/models') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MODELS) })
    if (url.hostname !== '127.0.0.1') return route.abort()
    return route.continue()
  })
}

test('the model picker searches OpenRouter’s list and shows prices, context and images', async ({ page }) => {
  await mockOpenRouter(page)
  await page.goto('/')
  await page.getByTestId('settings-button').click()
  const field = page.getByTestId('settings-model')
  await field.fill('sonnet 5')
  const options = page.getByTestId('settings-model-options')
  const option = options.locator('[data-model-id="anthropic/claude-sonnet-5"]')
  await expect(option).toContainText('Claude Sonnet 5')
  await expect(option).toContainText('$3.00 / $15')
  await expect(option).toContainText('200k')
  await option.click()
  await expect(field).toHaveValue('anthropic/claude-sonnet-5')
  await expect(page.getByTestId('settings-model-facts')).toContainText('Claude Sonnet 5')

  // Suggestions come first; free models say so.
  await page.getByText('Advanced').click()
  await page.getByTestId('settings-background-model').click()
  await expect(page.getByTestId('settings-background-model-options').locator('[data-model-id="google/gemma-4-31b-it:free"]')).toContainText('free')
})

test('with a key, Settings shows what it spent and each reply shows its tokens and cost', async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'same components on phones')
  await mockOpenRouter(page)
  const keyRequests: string[] = []
  await page.route('https://openrouter.ai/api/v1/key', (route) => {
    keyRequests.push(route.request().headers().authorization ?? '')
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { usage: 1.234, limit: 10, limit_remaining: 8.766, usage_daily: 0.05, is_free_tier: false } }) })
  })
  const bodies: Array<{ usage?: unknown }> = []
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    bodies.push(JSON.parse(route.request().postData() ?? '{}'))
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        'data: {"model":"openai/gpt-4.1-mini","choices":[{"delta":{"content":"Priced reply."}}]}',
        'data: {"model":"openai/gpt-4.1-mini","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1100,"completion_tokens":150,"total_tokens":1250,"cost":0.00312}}',
        'data: [DONE]',
        '',
      ].join('\n\n'),
    })
  })
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('treechat:provider:v1', JSON.stringify({ provider: 'openrouter', apiKey: 'test-only-never-sent', model: 'openai/gpt-4.1-mini' })))
  await page.reload()

  await page.getByTestId('settings-button').click()
  await expect(page.getByTestId('key-usage')).toContainText('$1.23 spent of $10 · $8.77 left')
  await expect(page.getByTestId('key-usage')).toContainText('today $0.05')
  expect(keyRequests).toEqual(['Bearer test-only-never-sent'])
  await page.keyboard.press('Escape')

  await page.getByTestId('thread-composer').fill('How much was that?')
  await page.getByTestId('thread-composer').press('Enter')
  await expect(page.locator('article').last()).toContainText('Priced reply.')
  expect(bodies[0]?.usage).toEqual({ include: true })
  const usage = page.getByTestId('message-usage')
  await expect(usage).toHaveText('GPT-4.1 Mini · 1.3k tokens · $0.0031')
  await expect(usage).toHaveAttribute('title', /1,100 in · 150 out/)
  await page.reload()
  await expect(page.getByTestId('message-usage')).toHaveText('GPT-4.1 Mini · 1.3k tokens · $0.0031')
})
