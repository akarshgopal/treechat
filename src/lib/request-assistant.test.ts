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
