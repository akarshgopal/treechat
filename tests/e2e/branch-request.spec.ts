import { expect, test } from './fixtures'

test('a settings-key branch sends its question, quote and ancestor context and renders the reply', async ({ page }) => {
  const requests: Array<{ session_id?: string; messages: Array<{ role: string; content: string }> }> = []
  await page.route('https://openrouter.ai/api/v1/chat/completions', (route) => {
    requests.push(route.request().postDataJSON())
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body:
      'data: {"choices":[{"delta":{"content":"The branch request reached the provider."}}]}\n\ndata: [DONE]\n\n',
    })
  })
  await page.goto('/')
  await page.getByTestId('settings-button').click()
  await page.getByTestId('settings-api-key').fill('test-only-intercepted-key')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByTestId('settings-restore-demo').click()
  await page.locator('article:has([data-message-id="msg-root-4"])').click()
  await page.locator('[data-ask-message="msg-root-4"]').click()
  await page.getByLabel('Your branch question').fill('Explain this passage precisely.')
  await page.getByLabel('Your branch question').press('Enter')
  await expect.poll(() => requests.length).toBe(1)
  expect(requests[0].messages.at(-1)).toMatchObject({ role: 'user', content: 'Explain this passage precisely.' })
  const system = requests[0].messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n')
  expect(system).toContain('SELECTED QUOTE')
  expect(system).toContain('Highlight text in any message, in any thread.')
  expect(system).toContain('What is TreeChat?')
  await expect(page.getByText('The branch request reached the provider.', { exact: true })).toBeVisible()
  await expect(page.getByTestId('composer-stop')).toHaveCount(0)
  await page.locator('article').filter({ hasText: 'Explain this passage precisely.' }).getByRole('button', { name: 'Regenerate response', exact: true }).click()
  await expect.poll(() => requests.length).toBe(2)
  expect(requests[1].messages.at(-1)?.content).toBe('Explain this passage precisely.')
  expect(requests[1].session_id).toBe(requests[0].session_id)
  await expect(page.getByText('The branch request reached the provider.', { exact: true })).toBeVisible()
  await expect(page.getByTestId('composer-stop')).toHaveCount(0)
  const response = page.locator('[data-selectable="true"]').filter({ hasText: 'The branch request reached the provider.' })
  const responseId = await response.getAttribute('data-message-id')
  await page.locator(`[data-ask-message="${responseId}"]`).click()
  await page.getByLabel('Your branch question').fill('Explain the nested context.')
  await page.getByLabel('Your branch question').press('Enter')
  await expect.poll(() => requests.length).toBe(3)
  const nestedSystem = requests[2].messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n')
  expect(nestedSystem).toContain('MAIN')
  expect(nestedSystem).toContain('BRANCH depth 1')
  expect(nestedSystem).toContain('Explain this passage precisely.')
  expect(requests[2].messages.at(-1)?.content).toBe('Explain the nested context.')
  expect(requests[2].session_id).toBe(requests[0].session_id)
  await expect(page.getByTestId('composer-stop')).toHaveCount(0)
})

test('a delayed branch shows progress, surfaces a stream error, and regenerates successfully', async ({ page }) => {
  let releaseResponse!: () => void
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve })
  let requests = 0
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    requests += 1
    if (requests === 1) {
      await responseGate
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: {"error":{"message":"Provider overloaded. Try again."}}\n\n' })
    }
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: {"choices":[{"delta":{"content":"Recovered reply"}}]}\n\ndata: [DONE]\n\n' })
  })
  await page.goto('/')
  await page.getByTestId('settings-button').click()
  await page.getByTestId('settings-api-key').fill('test-only-intercepted-key')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByTestId('settings-restore-demo').click()
  await page.locator('article:has([data-message-id="msg-root-4"])').click()
  await page.locator('[data-ask-message="msg-root-4"]').click()
  await page.getByLabel('Your branch question').fill('Answer after waiting.')
  await page.getByLabel('Your branch question').press('Enter')
  await expect(page.getByTestId('reply-progress')).toContainText('Waiting for response')
  releaseResponse()
  await expect(page.getByRole('alert')).toContainText('Provider overloaded')
  await expect(page.getByTestId('reply-progress')).toHaveCount(0)
  await expect(page.getByTestId('composer-stop')).toHaveCount(0)
  await page.locator('article').filter({ hasText: 'Answer after waiting.' }).getByRole('button', { name: 'Regenerate response', exact: true }).click()
  await expect(page.getByText('Recovered reply', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(requests).toBe(2)
})
