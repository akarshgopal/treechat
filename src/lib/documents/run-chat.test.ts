import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { type StreamChunk } from '@tanstack/ai'
import { takeRunCitations } from '../citations.ts'
import { resetLocalChatApiProbe, runChat } from '../client-chat.ts'
import { saveProviderConfig } from '../provider.ts'
import { setEmbedder } from './active-embedder.ts'
import { fakeEmbedder } from './embedder.ts'
import { indexFile } from './ingest.ts'
import { installLocalStorage } from '../../test-support/local-storage.ts'

const originalFetch = globalThis.fetch

beforeEach(async () => {
  installLocalStorage()
  resetLocalChatApiProbe()
  setEmbedder(fakeEmbedder)
  await indexFile(
    new File(['# Deploy\n\nThe site deploys to GitHub Pages from the main branch.\n\n# Cooking\n\nBoil pasta in salted water.'], 'handbook.md', { type: 'text/markdown' }),
    { id: 'handbook', embedder: fakeEmbedder },
  )
})

afterEach(() => {
  globalThis.fetch = originalFetch
  resetLocalChatApiProbe()
  setEmbedder(null)
})

async function drain(stream: AsyncIterable<StreamChunk>) {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

test('OpenRouter requests carry a DOCUMENTS system message and record citations', async () => {
  saveProviderConfig({ provider: 'openrouter', apiKey: 'key', model: 'test-model' })
  let body: { messages: Array<{ role: string; content: string }> } | null = null
  globalThis.fetch = (async (_input, init) => {
    body = JSON.parse(String(init?.body))
    return new Response('data: {"choices":[{"delta":{"content":"Pages [1]"}}]}\n\ndata: [DONE]\n\n')
  }) as typeof fetch

  await drain(runChat({
    messages: [{ role: 'user', content: 'Where does the site deploy?' }],
    forwardedProps: { documentIds: ['handbook'], cacheSessionId: 'chat-1' },
    threadId: 'thread-or',
    runId: 'run-1',
  }))

  const system = body!.messages.filter((message) => message.role === 'system')
  assert.match(system.at(-1)!.content, /^DOCUMENTS/)
  assert.match(system.at(-1)!.content, /\[1\] handbook\.md — Deploy/)
  assert.doesNotMatch(system.at(-1)!.content, /pasta/)
  const citations = takeRunCitations('thread-or')
  assert.deepEqual(citations?.map((citation) => [citation.id, citation.kind, citation.title, citation.documentId, citation.locator]), [
    ['1', 'document', 'handbook.md', 'handbook', 'Deploy'],
  ])
})
