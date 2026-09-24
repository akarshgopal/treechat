import { expect, test, type Page } from '@playwright/test'
import { tree } from './library'

/** Paste a generated 2000×1000 PNG, as a screenshot from the clipboard arrives. */
async function pasteScreenshot(page: Page) {
  await page.getByTestId('thread-composer').evaluate(async (target) => {
    const canvas = document.createElement('canvas')
    canvas.width = 2000
    canvas.height = 1000
    const context = canvas.getContext('2d')!
    context.fillStyle = '#c33'
    context.fillRect(0, 0, 2000, 1000)
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'))
    const data = new DataTransfer()
    data.items.add(new File([blob], 'image.png', { type: 'image/png' }))
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
}

/** Drop files onto the composer, the way a drag from the desktop does. */
async function dropOnComposer(page: Page, files: Array<{ name: string; type: string; text: string }>) {
  await page.locator('[data-attach-drop]').first().evaluate((target, files) => {
    const data = new DataTransfer()
    for (const file of files) data.items.add(new File([file.text], file.name, { type: file.type }))
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }))
    }
  }, files)
}

test.beforeEach(async ({ page }) => {
  // Static-site mock only: never reach a real provider from UI tests.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/status') return route.fulfill({ status: 404, body: 'Static mock' })
    if (url.hostname !== '127.0.0.1') return route.abort()
    return route.continue()
  })
  await page.goto('/')
})

test('a pasted screenshot is resized, sent, shown, and survives a reload', async ({ page }) => {
  await pasteScreenshot(page)
  const chip = page.getByTestId('composer-attachments').locator('[data-attachment-id]')
  await expect(chip).toHaveCount(1)
  await expect(chip).toHaveAttribute('title', /^Screenshot .*· 1568×784$/)

  // An image alone is a message: send with no text.
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByTestId('composer-attachments')).toHaveCount(0)
  await expect(page.locator('article').last()).toContainText('I received 1 image (Screenshot')
  const sent = (await tree(page)).threads['thread-root'].messages[0]!
  expect(sent).toMatchObject({ role: 'user', content: '', attachments: [{ kind: 'image', width: 1568, height: 784 }] })
  expect(JSON.stringify(sent)).not.toContain('data:image')

  await page.reload()
  const thumbnail = page.getByTestId('message-attachments').locator('img')
  await expect(thumbnail).toHaveAttribute('src', /^data:image\/(webp|jpeg);base64,/)
  await page.getByRole('button', { name: /^View Screenshot/ }).click()
  await expect(page.getByTestId('image-viewer').locator('img')).toBeVisible()
})

test('a dropped text file attaches to the composer, not to Documents', async ({ page }) => {
  await dropOnComposer(page, [{ name: 'notes.txt', type: 'text/plain', text: 'remember the milk' }])
  await expect(page.getByTestId('documents-drop-overlay')).toHaveCount(0)
  await expect(page.getByTestId('composer-attachments')).toContainText('notes.txt')
  await page.getByTestId('thread-composer').fill('What does this say?')
  await page.getByTestId('thread-composer').press('Enter')
  await expect(page.locator('article').last()).toContainText('1 file (notes.txt)')
  await expect(page.getByTestId('message-attachments')).toContainText('notes.txt')
})

test('a PDF dropped on the composer joins the chat’s Documents instead', async ({ page }) => {
  await dropOnComposer(page, [{ name: 'report.pdf', type: 'application/pdf', text: '%PDF-1.4 not really' }])
  await expect(page.getByTestId('attach-problem')).toContainText('report.pdf added to this chat’s Documents')
  await expect(page.getByTestId('composer-attachments')).toHaveCount(0)
})

test('with a key, images go to the model as image parts, with a warning for text-only models', async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'request shape is covered on desktop')
  const bodies: Array<{ model: string; messages: Array<{ role: string; content: unknown }> }> = []
  await page.route('https://openrouter.ai/api/v1/models', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: [
      { id: 'test/text-only', architecture: { input_modalities: ['text'] } },
      { id: 'openai/gpt-4.1-mini', architecture: { input_modalities: ['text', 'image'] } },
    ] }),
  }))
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    bodies.push(JSON.parse(route.request().postData() ?? '{}'))
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: {"choices":[{"delta":{"content":"A red rectangle."}}]}\n\ndata: [DONE]\n\n',
    })
  })
  await page.evaluate(() => localStorage.setItem('treechat:provider:v1', JSON.stringify({ provider: 'openrouter', apiKey: 'test-only-never-sent', model: 'test/text-only' })))
  await page.reload()

  await pasteScreenshot(page)
  const warning = page.getByTestId('vision-warning')
  await expect(warning).toContainText('text-only can’t read images')
  await warning.getByRole('button', { name: 'Switch to GPT-4.1 Mini' }).click()
  await expect(warning).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('treechat:provider:v1')!).model)).toBe('openai/gpt-4.1-mini')

  await page.getByTestId('thread-composer').fill('What is this?')
  await page.getByTestId('thread-composer').press('Enter')
  await expect(page.locator('article').last()).toContainText('A red rectangle.')
  // The background image description goes to the same endpoint; pick the chat turn.
  const asks = (body: (typeof bodies)[number], text: string) =>
    JSON.stringify(body.messages.at(-1)?.content).includes(text)
  const chat = bodies.find((body) => asks(body, 'What is this?'))!
  expect(chat.model).toBe('openai/gpt-4.1-mini')
  const user = chat.messages.at(-1)!
  expect(user.content).toEqual([
    { type: 'text', text: 'What is this?' },
    { type: 'image_url', image_url: { url: expect.stringMatching(/^data:image\/(webp|jpeg);base64,/) } },
  ])
  // The image gets its one-time description from a model that reads images.
  await expect.poll(() => bodies.some((body) => asks(body, 'Describe this image'))).toBe(true)
})
