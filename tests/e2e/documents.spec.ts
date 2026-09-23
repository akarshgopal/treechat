import { expect, test, type Page } from '@playwright/test'
import type { ChatSession, Citation } from '../../src/types'

const NOTES = [
  '# Garden',
  '',
  'Moss grows best in shade with steady moisture. Water the moss gently every morning.',
  '',
  '# Kitchen',
  '',
  'Sourdough bread needs a lively starter and a long, cool rise overnight.',
].join('\n')

async function activeSession(page: Page) {
  return page.evaluate(() => {
    const library = JSON.parse(localStorage.getItem('treechat:v3')!)
    return library.sessions.find((session: { id: string }) => session.id === library.activeSessionId) as ChatSession
  })
}

async function lastAssistantCitations(page: Page): Promise<Citation[] | undefined> {
  const session = await activeSession(page)
  const root = session.treeState.threads[session.treeState.rootId]!
  return root.messages.filter((message) => message.role === 'assistant').at(-1)?.citations
}

test.beforeEach(async ({ page }) => {
  // Deterministic bag-of-words embedder: never download the model in tests.
  await page.addInitScript(() => localStorage.setItem('treechat:fake-embedder', '1'))
  // Static-site mock only: never reach a real provider from UI tests.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/status') return route.fulfill({ status: 404, body: 'Static mock' })
    if (url.hostname !== '127.0.0.1') return route.abort()
    return route.continue()
  })
  await page.goto('/')
})

test('a document added to a chat is retrieved and cited, then removed', async ({ page }, testInfo) => {
  if (testInfo.project.use.isMobile) {
    // Phones have no sidebar: the chats dialog links to documents.
    await page.getByTestId('session-switcher').click()
    await page.getByTestId('session-library').getByTestId('documents-entry').click()
  } else {
    await expect(page.getByTestId('documents-section')).toBeVisible()
    await page.getByTestId('documents-chip').click()
  }

  const dialog = page.getByTestId('documents-dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByTestId('documents-file-input').setInputFiles({
    name: 'garden-notes.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(NOTES),
  })
  const row = dialog.getByTestId('document-row')
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('garden-notes.md')
  await expect(row).toHaveAttribute('data-status', 'ready')
  await expect(row).toContainText('Markdown')
  // Adding from a chat attaches the file to that chat.
  await expect(row.getByTestId('document-attach')).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('documents-chip')).toHaveAttribute('data-count', '1')

  const documentId = (await activeSession(page)).documentIds?.[0]
  expect(documentId).toMatch(/^doc-/)

  const composer = page.getByTestId('thread-composer')
  await composer.fill('How often should I water the moss?')
  await composer.press('Enter')
  await expect(page.getByTestId('reply-progress')).toHaveCount(0, { timeout: 15_000 })
  await expect(page.locator('article').last()).toContainText('Matching excerpts from your documents')

  await expect.poll(() => lastAssistantCitations(page)).toBeDefined()
  const citations = (await lastAssistantCitations(page))!
  expect(citations[0]).toMatchObject({
    id: '1',
    kind: 'document',
    title: 'garden-notes.md',
    documentId,
    locator: 'Garden',
  })
  expect(citations[0]!.snippet).toContain('Water the moss gently')

  // Documents survive a reload (IndexedDB) and stay attached (session storage).
  await page.reload()
  await expect(page.getByTestId('documents-chip')).toHaveAttribute('data-count', '1')

  await page.getByTestId('documents-chip').click()
  await expect(dialog.getByTestId('document-row')).toHaveAttribute('data-status', 'ready')
  await dialog.getByTestId('document-remove').click()
  await dialog.getByTestId('document-remove-confirm').click()
  await expect(dialog.getByTestId('document-row')).toHaveCount(0)
  await expect(dialog).toContainText('No documents yet')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('documents-chip')).toHaveAttribute('data-count', '0')
  expect((await activeSession(page)).documentIds).toBeUndefined()
  // The citation already on the reply is history and stays.
  expect((await lastAssistantCitations(page))?.[0]?.documentId).toBe(documentId)
})

test('unchecking a document stops the chat from searching it', async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'Attach toggles are the same component on phones')
  await page.getByTestId('documents-chip').click()
  const dialog = page.getByTestId('documents-dialog')
  await dialog.getByTestId('documents-file-input').setInputFiles({ name: 'kitchen.txt', mimeType: 'text/plain', buffer: Buffer.from('Sourdough starter needs feeding daily.') })
  await expect(dialog.getByTestId('document-row')).toHaveAttribute('data-status', 'ready')
  await dialog.getByTestId('document-attach').uncheck()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('documents-chip')).toHaveAttribute('data-count', '0')

  const composer = page.getByTestId('thread-composer')
  await composer.fill('How often do I feed the sourdough starter?')
  await composer.press('Enter')
  await expect(page.getByTestId('reply-progress')).toHaveCount(0, { timeout: 15_000 })
  await expect.poll(async () => (await activeSession(page)).treeState.threads[(await activeSession(page)).treeState.rootId]!.messages.length).toBe(2)
  expect(await lastAssistantCitations(page)).toBeUndefined()

  // Clean up the shared library for the next test.
  await page.getByTestId('documents-chip').click()
  await dialog.getByTestId('document-remove').click()
  await dialog.getByTestId('document-remove-confirm').click()
  await expect(dialog.getByTestId('document-row')).toHaveCount(0)
})
