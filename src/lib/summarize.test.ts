import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { resetLocalChatApiProbe } from './client-chat.ts'
import { saveProviderConfig } from './provider.ts'
import { refreshSummary } from './summarize.ts'
import type { ChatMessage, ThreadSummary } from '../types.ts'
import { installLocalStorage } from '../test-support/local-storage.ts'

const originalFetch = globalThis.fetch

beforeEach(() => {
  installLocalStorage()
  resetLocalChatApiProbe()
})

afterEach(() => {
  resetLocalChatApiProbe()
  globalThis.fetch = originalFetch
})

function conversation(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
    content: `turn ${i} `.padEnd(2400, 'x'),
    createdAt: 0,
  }))
}

test('only one summary runs per thread, and failures keep the old one', async () => {
  saveProviderConfig({ provider: 'openrouter', apiKey: 'sk-or-v1-test', model: 'openai/gpt-4.1-mini' })
  let calls = 0
  let release: () => void = () => {}
  globalThis.fetch = (async () => {
    calls += 1
    await new Promise<void>((resolve) => { release = resolve })
    return new Response('{"error":{"message":"Down"}}', { status: 503 })
  }) as typeof fetch
  const commits: ThreadSummary[] = []
  const messages = conversation(24)
  const first = refreshSummary('t-live', messages, undefined, (summary) => commits.push(summary))
  await refreshSummary('t-live', messages, undefined, (summary) => commits.push(summary))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(calls, 1)
  release()
  await first
  assert.deepEqual(commits, [])
})
