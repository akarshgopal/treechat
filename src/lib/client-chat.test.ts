import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { EventType } from '@tanstack/ai'
import { saveProviderConfig } from './provider.ts'
import {
  OPENROUTER_CHAT_URL,
  collectAssistantText,
  openRouterChatStream,
  runChat,
} from './client-chat.ts'
import { installLocalStorage } from '../test-support/local-storage.ts'

const originalFetch = globalThis.fetch

beforeEach(() => {
  installLocalStorage()
})

afterEach(() => {
  globalThis.fetch = originalFetch
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

test('runChat with model prefs but no key stays on the mock', async () => {
  saveProviderConfig({
    provider: 'openrouter',
    apiKey: '',
    model: 'x-ai/grok-4.6',
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

test('runChat sends a summarized thread as its summary plus the later messages', async () => {
  saveProviderConfig({ provider: 'openrouter', apiKey: 'sk-or-v1-live', model: 'openai/gpt-4.1-mini' })
  let sent: Array<{ role: string; content: string }> = []
  globalThis.fetch = (async (_input, init) => {
    sent = (JSON.parse(String(init?.body)) as { messages: typeof sent }).messages
    return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }) as typeof fetch

  await collectAssistantText(runChat({
    messages: [
      { id: 'a', role: 'user', content: 'old question' },
      { id: 'b', role: 'assistant', content: 'old answer' },
      { id: 'c', role: 'user', content: 'new question' },
    ],
    forwardedProps: { threadSummary: { content: 'They asked an old question.', throughMessageId: 'b' } },
    threadId: 't1',
    runId: 'r1',
  }))
  assert.deepEqual(sent.map((message) => message.role), ['system', 'system', 'user'])
  assert.match(sent[1].content, /^SUMMARY OF EARLIER CONVERSATION\nThey asked an old question\./)
  assert.equal(sent[2].content, 'new question')
  assert.ok(sent.every((message) => !message.content.includes('old answer')))
})

test('runChat sends the full transcript when the summary does not match it', async () => {
  saveProviderConfig({ provider: 'openrouter', apiKey: 'sk-or-v1-live', model: 'openai/gpt-4.1-mini' })
  let sent: Array<{ role: string; content: string }> = []
  globalThis.fetch = (async (_input, init) => {
    sent = (JSON.parse(String(init?.body)) as { messages: typeof sent }).messages
    return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }) as typeof fetch

  await collectAssistantText(runChat({
    messages: [
      { id: 'a', role: 'user', content: 'edited question' },
    ],
    forwardedProps: { threadSummary: { content: 'stale', throughMessageId: 'gone' } },
    threadId: 't1',
    runId: 'r1',
  }))
  assert.deepEqual(sent.map((message) => message.role), ['system', 'user'])
  assert.ok(sent.every((message) => !message.content.includes('stale')))
})
