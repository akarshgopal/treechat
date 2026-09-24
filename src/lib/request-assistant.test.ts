import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { clearProviderConfig, saveProviderConfig } from './provider.ts'
import { resetLocalChatApiProbe } from './client-chat.ts'
import { requestAssistantText } from './request-assistant.ts'

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

function sse(text: string) {
  return new Response(`data: {"choices":[{"delta":{"content":${JSON.stringify(text)}}}]}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

test('background requests try the background model first', async () => {
  saveProviderConfig({
    provider: 'openrouter',
    apiKey: 'sk-or-v1-test',
    model: 'anthropic/claude-sonnet-4',
    backgroundModel: 'meta-llama/llama-3.3-70b-instruct:free',
  })
  const models: string[] = []
  globalThis.fetch = (async (_input, init) => {
    models.push((JSON.parse(String(init?.body)) as { model: string }).model)
    return sse('cheap draft')
  }) as typeof fetch

  assert.equal(await requestAssistantText('summarize', undefined, undefined, undefined, { background: true }), 'cheap draft')
  assert.deepEqual(models, ['meta-llama/llama-3.3-70b-instruct:free'])
  // Ordinary requests stay on the main model.
  assert.equal(await requestAssistantText('hello'), 'cheap draft')
  assert.deepEqual(models.at(-1), 'anthropic/claude-sonnet-4')
})

test('a rate-limited background model falls back once to the main model', async () => {
  saveProviderConfig({
    provider: 'openrouter',
    apiKey: 'sk-or-v1-test',
    model: 'anthropic/claude-sonnet-4',
    backgroundModel: 'meta-llama/llama-3.3-70b-instruct:free',
  })
  const models: string[] = []
  globalThis.fetch = (async (_input, init) => {
    const model = (JSON.parse(String(init?.body)) as { model: string }).model
    models.push(model)
    if (model.endsWith(':free')) {
      return new Response('{"error":{"message":"Rate limit exceeded"}}', { status: 429 })
    }
    return sse('main draft')
  }) as typeof fetch

  assert.equal(await requestAssistantText('summarize', undefined, undefined, undefined, { background: true }), 'main draft')
  assert.deepEqual(models, ['meta-llama/llama-3.3-70b-instruct:free', 'anthropic/claude-sonnet-4'])
})

test('a failing main model after the fallback surfaces its error', async () => {
  saveProviderConfig({
    provider: 'openrouter',
    apiKey: 'sk-or-v1-test',
    model: 'anthropic/claude-sonnet-4',
    backgroundModel: 'openai/gpt-4.1-nano',
  })
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    return new Response('{"error":{"message":"Down"}}', { status: 503 })
  }) as typeof fetch
  await assert.rejects(
    requestAssistantText('summarize', undefined, undefined, undefined, { background: true }),
    /Down/,
  )
  assert.equal(calls, 2)
})
