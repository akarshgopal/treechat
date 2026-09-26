import { expect, test, type Page } from '@playwright/test'

const MODELS = { data: [
  { id: 'openai/gpt-5.6-luna', name: 'OpenAI: GPT-5.6 Luna', context_length: 1050000, pricing: { prompt: '0.0000002', completion: '0.0000012' }, architecture: { input_modalities: ['text', 'image'] } },
  { id: 'anthropic/claude-sonnet-5', name: 'Anthropic: Claude Sonnet 5', context_length: 1000000, pricing: { prompt: '0.000002', completion: '0.00001' }, architecture: { input_modalities: ['text', 'image'] } },
  { id: 'qwen/qwen3.8-27b:free', name: 'Qwen: Qwen3.8 27B (free)', context_length: 262144, pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text', 'image'] } },
] }

async function mockOpenRouter(page: Page) {
  // Static-site mock only: never reach a real provider from UI tests.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.href === 'https://openrouter.ai/api/v1/models') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MODELS) })
    if (url.hostname !== '127.0.0.1') return route.abort()
    return route.continue()
  })
}

test('the model picker is a search-select over OpenRouter’s list, and still takes any id', async ({ page }) => {
  await mockOpenRouter(page)
  await page.goto('/')
  await page.getByTestId('settings-button').click()
  const picker = page.getByTestId('settings-model')
  await expect(picker).toHaveAttribute('data-value', 'openai/gpt-5.6-luna')
  await picker.click()
  // Suggestions first, with price per million tokens, context and images.
  const options = page.getByTestId('settings-model-options')
  await expect(options.locator('[data-model-id]').first()).toHaveAttribute('data-model-id', 'openai/gpt-5.6-luna')
  await page.getByTestId('settings-model-search').fill('sonnet 5')
  const option = options.locator('[data-model-id="anthropic/claude-sonnet-5"]')
  await expect(option).toContainText('Claude Sonnet 5')
  await expect(option).toContainText('$2.00 / $10')
  await expect(option).toContainText('1M')
  await page.getByTestId('settings-model-search').press('Enter')
  await expect(options).toHaveCount(0)
  await expect(picker).toHaveAttribute('data-value', 'anthropic/claude-sonnet-5')
  await expect(picker).toContainText('Claude Sonnet 5')

  // An id OpenRouter does not list can still be used; a half-typed one cannot.
  await picker.click()
  await page.getByTestId('settings-model-search').fill('acme')
  await expect(options.getByText(/^Use /)).toHaveCount(0)
  await page.getByTestId('settings-model-search').fill('acme/next-model')
  await options.getByText('Use “acme/next-model”').click()
  await expect(picker).toHaveAttribute('data-value', 'acme/next-model')

  await page.getByText('Advanced').click()
  await page.getByTestId('settings-background-model').click()
  const background = page.getByTestId('settings-background-model-options')
  await expect(background.locator('[data-model-id]').first()).toContainText('Same as the main model')
  await expect(background.locator('[data-model-id="qwen/qwen3.8-27b:free"]')).toContainText('free')
  await page.keyboard.press('Escape')
  // Escape closes only the panel, not Settings.
  await expect(page.getByTestId('settings-dialog')).toBeVisible()
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
        'data: {"model":"openai/gpt-5.6-luna","choices":[{"delta":{"content":"Priced reply."}}]}',
        'data: {"model":"openai/gpt-5.6-luna","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1100,"completion_tokens":150,"total_tokens":1250,"cost":0.00312}}',
        'data: [DONE]',
        '',
      ].join('\n\n'),
    })
  })
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('treechat:provider:v1', JSON.stringify({ provider: 'openrouter', apiKey: 'test-only-never-sent', model: 'openai/gpt-5.6-luna' })))
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
  await expect(usage).toHaveText('GPT-5.6 Luna · 1.3k tokens · $0.0031')
  await expect(usage).toHaveAttribute('title', /1,100 in · 150 out/)
  await page.reload()
  await expect(page.getByTestId('message-usage')).toHaveText('GPT-5.6 Luna · 1.3k tokens · $0.0031')
})
