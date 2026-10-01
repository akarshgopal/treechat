import { expect, test } from './fixtures'

const LOCAL = 'http://localhost:11434/v1/chat/completions'

test('a custom server can be connected in Settings, answers without a key, and can be disconnected', async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'same components on phones')
  const requests: Array<{ headers: Record<string, string>; body: Record<string, unknown> }> = []
  await page.route(LOCAL, async (route) => {
    requests.push({ headers: route.request().headers(), body: JSON.parse(route.request().postData() ?? '{}') })
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        'data: {"model":"llama3.2","choices":[{"delta":{"content":"Hello from my own server."}}]}',
        'data: {"model":"llama3.2","choices":[],"usage":{"prompt_tokens":20,"completion_tokens":5}}',
        'data: [DONE]',
        '',
      ].join('\n\n'),
    })
  })
  await page.goto('/')
  await expect(page.getByTestId('provider-mode')).toBeVisible()

  await page.getByTestId('settings-button').click()
  await page.getByTestId('settings-provider').selectOption('ollama')
  await expect(page.getByTestId('settings-base-url')).toHaveValue('http://localhost:11434/v1')
  // No OpenRouter list for a custom server; the model is whatever the server names.
  await expect(page.getByTestId('settings-model')).toHaveAttribute('data-value', 'llama3.2')

  // An unfinished URL blocks Save; the key field is optional.
  await page.getByTestId('settings-base-url').fill('localhost')
  await expect(page.getByTestId('settings-base-url-error')).toBeVisible()
  await expect(page.getByTestId('settings-save')).toBeDisabled()
  await page.getByTestId('settings-base-url').fill('http://localhost:11434/v1')

  await page.getByText('Advanced').click()
  await page.getByTestId('settings-headers').fill('X-Team: research')
  await page.getByTestId('settings-extra-body').fill('{ "top_p": 0.9 }')
  await page.getByTestId('settings-save').click()
  await expect(page.getByText('Saved in this browser')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('settings-dialog')).toHaveCount(0)

  // Live now, with no key: the demo badge is gone and the web-search globe is hidden.
  await expect(page.getByTestId('provider-mode')).toHaveCount(0)
  await page.getByTestId('thread-composer').fill('Hi there')
  await page.getByTestId('thread-composer').press('Enter')
  await expect(page.locator('article').last()).toContainText('Hello from my own server.')
  expect(requests).toHaveLength(1)
  expect(requests[0]!.headers.authorization).toBeUndefined()
  expect(requests[0]!.headers['x-team']).toBe('research')
  expect(requests[0]!.body).toMatchObject({ model: 'llama3.2', stream: true, top_p: 0.9 })
  expect(requests[0]!.body).not.toHaveProperty('session_id')
  await expect(page.getByTestId('message-usage')).toContainText('llama3.2 · 25 tokens')

  // Disconnecting goes back to the demo.
  await page.getByTestId('settings-button').click()
  await page.getByTestId('settings-clear').click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('settings-dialog')).toHaveCount(0)
  await expect(page.getByTestId('provider-mode')).toBeVisible()
})

test('switching provider never carries a key to another server', async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'same components on phones')
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('treechat:provider:v1', JSON.stringify({ provider: 'openrouter', apiKey: 'sk-or-secret', model: 'openai/gpt-6-luna' })))
  await page.reload()
  await page.getByTestId('settings-button').click()
  await expect(page.getByTestId('settings-api-key')).toHaveValue('sk-or-secret')
  await page.getByTestId('settings-provider').selectOption('custom')
  await expect(page.getByTestId('settings-api-key')).toHaveValue('')
  await page.getByTestId('settings-provider').selectOption('openrouter')
  await expect(page.getByTestId('settings-api-key')).toHaveValue('sk-or-secret')
})

test('saved headers are not sent to a different server, and a preset with an edited URL can still be disconnected', async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'same components on phones')
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('treechat:provider:v1', JSON.stringify({
    provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', apiKey: 'sk-local', model: 'llama3.2', headers: { 'api-key': 'gateway-secret' },
  })))
  await page.reload()
  await page.getByTestId('settings-button').click()
  // Advanced opens by itself when headers are saved.
  await page.getByTestId('settings-base-url').fill('http://localhost:9999/v1?api-version=1')
  // Same key and headers, new host: Save waits.
  await expect(page.getByTestId('settings-secrets-warning')).toBeVisible()
  await expect(page.getByTestId('settings-save')).toBeDisabled()
  await page.getByTestId('settings-api-key').fill('')
  await page.getByTestId('settings-headers').fill('')
  await expect(page.getByTestId('settings-save')).toBeEnabled()
  await page.getByTestId('settings-save').click()
  await expect(page.getByText('Saved in this browser')).toBeVisible()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('treechat:provider:v1') ?? '{}').baseUrl)).toBe('http://localhost:9999/v1?api-version=1')

  // The URL no longer matches the preset, yet Disconnect is still there.
  await page.getByTestId('settings-clear').click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('settings-dialog')).toHaveCount(0)
  await expect(page.getByTestId('provider-mode')).toBeVisible()
})

test('a first reply that fails leaves the message with a way to try again, even after a reload', async ({ page }) => {
  let calls = 0
  await page.route('https://openrouter.ai/api/v1/chat/completions', (route) => {
    calls += 1
    return calls === 1
      ? route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Provider returned error' } }) })
      : route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: {"choices":[{"delta":{"content":"Second time lucky."}}]}\n\ndata: [DONE]\n\n' })
  })
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('treechat:provider:v1', JSON.stringify({ provider: 'openrouter', apiKey: 'k', model: 'openai/gpt-6-luna' })))
  await page.reload()
  await page.getByTestId('thread-composer').fill('My first message')
  await page.getByTestId('thread-composer').press('Enter')
  await expect(page.getByRole('alert')).toContainText('Provider returned error')

  // The error goes with the page, but a blank reply must not take its place.
  await expect(page.locator('article')).toHaveCount(1)
  await page.reload()
  await expect(page.locator('article')).toHaveCount(1)
  await expect(page.getByTestId('unanswered-notice')).toBeVisible()
  await page.getByTestId('unanswered-notice').getByRole('button', { name: 'Try again' }).click()
  await expect(page.locator('article').last()).toContainText('Second time lucky.')
  await expect(page.getByTestId('unanswered-notice')).toHaveCount(0)
  expect(calls).toBe(2)
})
