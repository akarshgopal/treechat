import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { EventType } from '@tanstack/ai'
import { saveProviderConfig, clearProviderConfig } from './provider.ts'
import {
  OPENROUTER_CHAT_URL,
  buildOpenRouterMessages,
  collectAssistantText,
  contentDeltaFromOpenAIData,
  hasLocalChatApi,
  openRouterChatStream,
  openRouterHeaders,
  openRouterRequestBody,
  resetLocalChatApiProbe,
  resolveChatBackend,
  runChat,
  toOpenAIChatMessages,
} from './client-chat.ts'

const originalFetch = globalThis.fetch

function installLocalStorage() {
  const store = new Map<string, string>()
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorage,
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

test('contentDeltaFromOpenAIData reads streaming content and ignores done', () => {
  assert.equal(
    contentDeltaFromOpenAIData(
      '{"choices":[{"delta":{"content":"Hello"}}]}',
    ),
    'Hello',
  )
  assert.equal(contentDeltaFromOpenAIData('[DONE]'), null)
  assert.equal(contentDeltaFromOpenAIData('{'), null)
  assert.equal(
    contentDeltaFromOpenAIData('{"choices":[{"delta":{"content":""}}]}'),
    null,
  )
})

test('toOpenAIChatMessages keeps user and assistant text', () => {
  assert.deepEqual(
    toOpenAIChatMessages([
      { role: 'user', content: 'hi' },
      { role: 'assistant', parts: [{ type: 'text', content: 'hello' }] },
      { role: 'tool', content: 'skip' },
    ]),
    [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ],
  )
})

test('buildOpenRouterMessages prepends MAIN and SELECTED QUOTE system prompts', () => {
  const messages = buildOpenRouterMessages([{ role: 'user', content: 'and then?' }], {
    quote: 'a moss underline',
    context: 'MAIN\nhello\n\nSELECTED QUOTE\n«a moss underline»',
  })
  assert.equal(messages[0]?.role, 'system')
  assert.match(messages[0]?.content ?? '', /TreeChat/)
  assert.equal(messages[1]?.role, 'system')
  assert.match(messages[1]?.content ?? '', /SELECTED QUOTE/)
  assert.match(messages[1]?.content ?? '', /MAIN/)
  assert.equal(messages.at(-1)?.content, 'and then?')
})

test('openRouterHeaders use Bearer, HTTP-Referer, and X-Title', () => {
  const headers = openRouterHeaders(
    { provider: 'openrouter', apiKey: 'sk-or-v1-test', model: 'openai/gpt-4.1-mini' },
    'https://akarshgopal.github.io',
  )
  assert.equal(headers.Authorization, 'Bearer sk-or-v1-test')
  assert.equal(headers['HTTP-Referer'], 'https://akarshgopal.github.io')
  assert.equal(headers['X-Title'], 'TreeChat')
})

test('openRouterRequestBody includes model and optional generation params', () => {
  const messages = [{ role: 'user' as const, content: 'hi' }]
  assert.deepEqual(
    openRouterRequestBody(
      { provider: 'openrouter', apiKey: 'k', model: 'x-ai/grok-4' },
      messages,
    ),
    { model: 'x-ai/grok-4', messages, stream: true },
  )
  assert.deepEqual(
    openRouterRequestBody(
      {
        provider: 'openrouter',
        apiKey: 'k',
        model: 'anthropic/claude-sonnet-4',
        temperature: 0,
        maxTokens: 256,
      },
      messages,
    ),
    {
      model: 'anthropic/claude-sonnet-4',
      messages,
      stream: true,
      temperature: 0,
      max_tokens: 256,
    },
  )
})

test('resolveChatBackend is openrouter when a key is saved', async () => {
  globalThis.fetch = (async () => new Response('ok', { status: 200 })) as typeof fetch
  saveProviderConfig({
    provider: 'openrouter',
    apiKey: 'sk-or-v1-test',
    model: 'openai/gpt-4.1-mini',
  })
  assert.equal(await resolveChatBackend(), 'openrouter')
})

test('resolveChatBackend is mock when no key and /api/status is missing', async () => {
  globalThis.fetch = (async () => new Response('nope', { status: 404 })) as typeof fetch
  assert.equal(await resolveChatBackend(), 'mock')
})

test('resolveChatBackend is local-api when /api/status is reachable', async () => {
  globalThis.fetch = (async (input) => {
    const url = String(input)
    if (url.includes('/api/status')) {
      return new Response(JSON.stringify({ mode: 'mock', provider: 'mock' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    throw new Error(`unexpected ${url}`)
  }) as typeof fetch
  assert.equal(await resolveChatBackend(), 'local-api')
  assert.equal(await hasLocalChatApi(), true)
})

test('openRouterChatStream converts OpenAI SSE into TEXT_MESSAGE_* events', async () => {
  const sse = [
    'data: {"choices":[{"delta":{"content":"Hello"}}]}',
    '',
    'data: {"choices":[{"delta":{"content":" world"}}]}',
    '',
    'data: [DONE]',
    '',
  ].join('\n')

  const urls: string[] = []
  globalThis.fetch = (async (input, init) => {
    urls.push(String(input))
    assert.equal(init?.method, 'POST')
    const headers = init?.headers as Record<string, string>
    assert.equal(headers.Authorization, 'Bearer sk-or-v1-test')
    assert.equal(headers['HTTP-Referer'] != null, true)
    assert.equal(headers['X-Title'], 'TreeChat')
    const body = JSON.parse(String(init?.body)) as {
      stream: boolean
      model: string
      temperature?: number
      max_tokens?: number
      messages: Array<{ role: string }>
    }
    assert.equal(body.stream, true)
    assert.equal(body.model, 'google/gemini-2.5-flash')
    assert.equal(body.temperature, 0.4)
    assert.equal(body.max_tokens, 800)
    assert.equal(body.messages[0]?.role, 'system')
    return new Response(sse, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }) as typeof fetch

  const text = await collectAssistantText(
    openRouterChatStream({
      messages: [{ role: 'user', content: 'hi' }],
      config: {
        provider: 'openrouter',
        apiKey: 'sk-or-v1-test',
        model: 'google/gemini-2.5-flash',
        temperature: 0.4,
        maxTokens: 800,
      },
      forwardedProps: {},
      threadId: 't1',
      runId: 'r1',
    }),
  )
  assert.equal(text, 'Hello world')
  assert.deepEqual(urls, [OPENROUTER_CHAT_URL])
})

test('runChat with a saved key never posts to /api/chat', async () => {
  saveProviderConfig({
    provider: 'openrouter',
    apiKey: 'sk-or-v1-live',
    model: 'openai/gpt-4.1-mini',
  })
  const urls: string[] = []
  globalThis.fetch = (async (input) => {
    urls.push(String(input))
    return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }) as typeof fetch

  const text = await collectAssistantText(
    runChat({
      messages: [{ role: 'user', content: 'hi' }],
      threadId: 't1',
      runId: 'r1',
    }),
  )
  assert.equal(text, 'ok')
  assert.ok(urls.every((url) => url.includes('openrouter.ai')))
  assert.ok(urls.every((url) => !url.includes('/api/chat')))
})

test('runChat with model prefs but no key stays on the mock', async () => {
  saveProviderConfig({
    provider: 'openrouter',
    apiKey: '',
    model: 'x-ai/grok-4',
    temperature: 0.2,
    maxTokens: 128,
  })
  const urls: string[] = []
  globalThis.fetch = (async (input) => {
    urls.push(String(input))
    return new Response('missing', { status: 404 })
  }) as typeof fetch

  const chunks = []
  for await (const chunk of runChat({
    messages: [{ role: 'user', content: 'What is TreeChat?' }],
    threadId: 't1',
    runId: 'r1',
  })) {
    chunks.push(chunk)
    if (chunk.type === EventType.TEXT_MESSAGE_CONTENT) break
  }
  assert.ok(chunks.some((chunk) => chunk.type === EventType.TEXT_MESSAGE_START))
  assert.ok(urls.every((url) => !url.includes('openrouter.ai')))
  assert.ok(urls.every((url) => !url.includes('/api/chat')))
})

test('openRouterChatStream abort after start does not emit RUN_ERROR', async () => {
  const controller = new AbortController()
  const encoder = new TextEncoder()
  globalThis.fetch = (async (_input, init) => {
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'),
        )
        const signal = init?.signal
        if (signal) {
          if (signal.aborted) {
            stream.close()
            return
          }
          signal.addEventListener(
            'abort',
            () => {
              stream.error(new DOMException('Aborted', 'AbortError'))
            },
            { once: true },
          )
        }
      },
    })
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }) as typeof fetch

  const chunks = []
  const stream = openRouterChatStream({
    messages: [{ role: 'user', content: 'hi' }],
    config: {
      provider: 'openrouter',
      apiKey: 'sk-or-v1-test',
      model: 'openai/gpt-4.1-mini',
    },
    forwardedProps: {},
    threadId: 't1',
    runId: 'r1',
    signal: controller.signal,
  })
  for await (const chunk of stream) {
    chunks.push(chunk)
    if (chunk.type === EventType.TEXT_MESSAGE_CONTENT) controller.abort()
  }
  assert.ok(chunks.some((chunk) => chunk.type === EventType.TEXT_MESSAGE_CONTENT))
  assert.ok(!chunks.some((chunk) => chunk.type === EventType.RUN_ERROR))
  assert.equal(chunks.at(-1)?.type, EventType.RUN_FINISHED)
})

test('openRouterChatStream abort before response is silent', async () => {
  const controller = new AbortController()
  globalThis.fetch = (async (_input, init) => {
    const signal = init?.signal
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    await new Promise<void>((_, reject) => {
      signal?.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      )
    })
    return new Response('', { status: 200 })
  }) as typeof fetch

  controller.abort()
  const chunks = []
  for await (const chunk of openRouterChatStream({
    messages: [{ role: 'user', content: 'hi' }],
    config: {
      provider: 'openrouter',
      apiKey: 'sk-or-v1-test',
      model: 'openai/gpt-4.1-mini',
    },
    threadId: 't1',
    runId: 'r1',
    signal: controller.signal,
  })) {
    chunks.push(chunk)
  }
  assert.ok(chunks.some((chunk) => chunk.type === EventType.RUN_STARTED))
  assert.ok(!chunks.some((chunk) => chunk.type === EventType.RUN_ERROR))
})

test('runChat without a key and without /api uses the client mock', async () => {
  const urls: string[] = []
  globalThis.fetch = (async (input) => {
    urls.push(String(input))
    return new Response('missing', { status: 404 })
  }) as typeof fetch

  const chunks = []
  for await (const chunk of runChat({
    messages: [{ role: 'user', content: 'What is TreeChat?' }],
    threadId: 't1',
    runId: 'r1',
  })) {
    chunks.push(chunk)
    if (chunk.type === EventType.TEXT_MESSAGE_CONTENT) break
  }
  assert.ok(chunks.some((chunk) => chunk.type === EventType.TEXT_MESSAGE_START))
  assert.ok(urls.every((url) => url.includes('/api/status')))
  assert.ok(urls.every((url) => !url.includes('/api/chat')))
  assert.ok(urls.every((url) => !url.includes('openrouter.ai')))
})

const streamInput = {
  messages: [{ role: 'user', content: 'hello' }],
  config: { provider: 'openrouter' as const, apiKey: 'test', model: 'test-model' },
  threadId: 'branch-1',
  runId: 'run-1',
  forwardedProps: { cacheSessionId: 'chat-session-1' },
}

test('streaming preserves split UTF-8, CRLF frames and a final unterminated frame', async () => {
  const encoded = new TextEncoder().encode(
    ': heartbeat\r\n\r\ndata: {"choices":[{"delta":{"content":"Hi 🌱"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"!"}}]}',
  )
  globalThis.fetch = (async (_input, init) => {
    assert.equal(JSON.parse(String(init?.body)).session_id, 'chat-session-1')
    return new Response(new ReadableStream({
      start(controller) {
        for (const byte of encoded) controller.enqueue(new Uint8Array([byte]))
        controller.close()
      },
    }))
  }) as typeof fetch
  assert.equal(await collectAssistantText(openRouterChatStream(streamInput)), 'Hi 🌱!')
})

test('provider errors inside a successful HTTP stream surface instead of silently finishing', async () => {
  globalThis.fetch = (async () => new Response(
    'data: {"choices":[{"delta":{"content":"Partial"}}]}\n\ndata: {"error":{"message":"Provider overloaded"}}\n\n',
  )) as typeof fetch
  const chunks = []
  for await (const chunk of openRouterChatStream(streamInput)) chunks.push(chunk)
  assert.ok(chunks.some((chunk) => chunk.type === EventType.TEXT_MESSAGE_CONTENT))
  assert.ok(chunks.some((chunk) => chunk.type === EventType.RUN_ERROR && chunk.message === 'Provider overloaded'))
  assert.ok(!chunks.some((chunk) => chunk.type === EventType.RUN_FINISHED))
})

test('empty provider streams and error finish reasons surface a retryable error', async () => {
  for (const body of ['', 'data: [DONE]\n\n', 'data: {"choices":[{"finish_reason":"error"}]}\n\n']) {
    globalThis.fetch = (async () => new Response(body)) as typeof fetch
    await assert.rejects(collectAssistantText(openRouterChatStream(streamInput)), /provider/i)
  }
})

test('routing sessions are bounded to the provider limit', () => {
  assert.equal(openRouterRequestBody(streamInput.config, [], 'a'.repeat(300)).session_id?.length, 256)
})
