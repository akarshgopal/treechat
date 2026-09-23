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

test('requestAssistantText streams from OpenRouter when a key is set', async () => {
  saveProviderConfig({
    provider: 'openrouter',
    apiKey: 'sk-or-v1-test',
    model: 'anthropic/claude-sonnet-4',
    temperature: 0.3,
    maxTokens: 400,
  })
  const urls: string[] = []
  globalThis.fetch = (async (input, init) => {
    urls.push(String(input))
    const body = JSON.parse(String(init?.body)) as {
      model: string
      temperature?: number
      max_tokens?: number
      messages: Array<{ role: string; content: string }>
    }
    assert.equal(body.model, 'anthropic/claude-sonnet-4')
    assert.equal(body.temperature, 0.3)
    assert.equal(body.max_tokens, 400)
    assert.equal(body.messages[0]?.role, 'system')
    assert.match(body.messages[1]?.content ?? '', /SELECTED QUOTE/)
    assert.match(body.messages.at(-1)?.content ?? '', /Summarize/)
    return new Response(
      'data: {"choices":[{"delta":{"content":"Folded the tangent."}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    )
  }) as typeof fetch

  const text = await requestAssistantText(
    'Summarize this TreeChat side-thread',
    'a moss underline',
    'MAIN\nhello\n\nSELECTED QUOTE\n«a moss underline»',
  )
  assert.equal(text, 'Folded the tangent.')
  assert.ok(urls.every((url) => url.includes('openrouter.ai')))
  assert.ok(urls.every((url) => !url.includes('/api/chat')))
})

test('requestAssistantText uses the client mock when Pages has no API', async () => {
  globalThis.fetch = (async (input) => {
    const url = String(input)
    if (url.includes('/api/status')) return new Response('nope', { status: 404 })
    throw new Error(`unexpected fetch ${url}`)
  }) as typeof fetch

  const text = await requestAssistantText(
    'summarize this branch',
    'select any passage',
  )
  assert.match(text, /The exploration on/)
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
