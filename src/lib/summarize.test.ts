import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { resetLocalChatApiProbe } from './client-chat.ts'
import { prefixFingerprint } from './compaction.ts'
import { clearProviderConfig, saveProviderConfig } from './provider.ts'
import { mockSummary, refreshSummary, summaryPrompt } from './summarize.ts'
import type { ChatMessage, ThreadSummary } from '../types.ts'

const originalFetch = globalThis.fetch

function installLocalStorage() {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
      clear: () => store.clear(),
    },
    configurable: true,
  })
}

beforeEach(() => {
  installLocalStorage()
  resetLocalChatApiProbe()
  clearProviderConfig()
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

test('the summary prompt folds new messages into the previous summary', () => {
  const messages = conversation(2)
  const prompt = summaryPrompt({ previous: 'Earlier: A.', messages, throughMessageId: 'm1' })
  assert.match(prompt, /Summary so far:\nEarlier: A\./)
  assert.match(prompt, /user: turn 0/)
  assert.match(prompt, /assistant: turn 1/)
  assert.doesNotMatch(summaryPrompt({ messages, throughMessageId: 'm1' }), /Summary so far/)
})

test('demo mode summarizes locally without calling a model', async () => {
  const urls: string[] = []
  globalThis.fetch = (async (input) => {
    urls.push(String(input))
    return new Response('nope', { status: 404 })
  }) as typeof fetch
  const messages = conversation(24)
  const commits: Array<{ summary: ThreadSummary; basis: string }> = []
  await refreshSummary('t-demo', messages, undefined, (summary, basis) => commits.push({ summary, basis }))
  assert.deepEqual(urls, ['/api/status'])
  assert.equal(commits.length, 1)
  assert.equal(commits[0].summary.throughMessageId, 'm17')
  assert.equal(commits[0].basis, prefixFingerprint(messages, 'm17'))
  assert.match(commits[0].summary.content, /- assistant: turn 17 x+…$/)
  assert.doesNotMatch(commits[0].summary.content, /turn 18/)
  assert.ok(mockSummary({ messages: conversation(200), throughMessageId: 'x' }).length <= 1600)
})

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
