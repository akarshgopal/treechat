import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { EventType } from '@tanstack/ai'
import { saveProviderConfig } from './provider.ts'
import {
  OPENROUTER_CHAT_URL,
  collectAssistantText,
  providerChatStream,
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

test('providerChatStream converts OpenAI SSE into TEXT_MESSAGE_* events', async () => {
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
    providerChatStream({
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

test('providerChatStream abort after start does not emit RUN_ERROR', async () => {
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
  const stream = providerChatStream({
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

test('providerChatStream abort before response is silent', async () => {
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
  for await (const chunk of providerChatStream({
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
  assert.equal(await collectAssistantText(providerChatStream(streamInput)), 'Hi 🌱!')
})

test('empty provider streams and error finish reasons surface a retryable error', async () => {
  for (const body of ['', 'data: [DONE]\n\n', 'data: {"choices":[{"finish_reason":"error"}]}\n\n']) {
    globalThis.fetch = (async () => new Response(body)) as typeof fetch
    await assert.rejects(collectAssistantText(providerChatStream(streamInput)), /provider/i)
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

const SSE_OK = 'data: {"choices":[{"delta":{"content":"ok"}}],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\ndata: [DONE]\n\n'

type Captured = { url: string; headers: Record<string, string>; body: Record<string, unknown> }

function captureFetch(response: () => Response = () => new Response(SSE_OK, { status: 200 })): Captured[] {
  const calls: Captured[] = []
  globalThis.fetch = (async (input, init) => {
    calls.push({
      url: String(input),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    })
    return response()
  }) as typeof fetch
  return calls
}

test('a custom server gets a plain OpenAI request at its own URL, without OpenRouter extras', async () => {
  const calls = captureFetch()
  await collectAssistantText(providerChatStream({
    messages: [{ role: 'user', content: 'hi' }],
    config: { provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'llama3.2', temperature: 0.2 },
    forwardedProps: { webSearch: true },
    threadId: 't1',
    runId: 'r1',
  }))
  const [call] = calls
  assert.equal(call.url, 'http://localhost:11434/v1/chat/completions')
  // No key: no Authorization header, and none of OpenRouter's referrer headers.
  assert.deepEqual(Object.keys(call.headers).sort(), ['Content-Type'])
  assert.equal(call.body.model, 'llama3.2')
  assert.equal(call.body.temperature, 0.2)
  assert.deepEqual(call.body.stream_options, { include_usage: true })
  for (const field of ['usage', 'session_id', 'plugins']) assert.equal(field in call.body, false, field)
})

test('a custom server sends its key, custom headers and extra options; extras cannot replace the core fields', async () => {
  const calls = captureFetch()
  await collectAssistantText(providerChatStream({
    messages: [{ role: 'user', content: 'hi' }],
    config: {
      provider: 'openai-compatible',
      baseUrl: 'https://gw.example/openai/deployments/x/chat/completions',
      apiKey: 'sk-test',
      model: 'gpt-4.1',
      headers: { 'api-key': 'azure-key', 'X-Team': 'research' },
      extraBody: { reasoning_effort: 'low', model: 'evil', stream: false, messages: [] },
    },
    forwardedProps: {},
    threadId: 't1',
    runId: 'r1',
  }))
  const [call] = calls
  // A full endpoint URL is used as typed.
  assert.equal(call.url, 'https://gw.example/openai/deployments/x/chat/completions')
  assert.equal(call.headers.Authorization, 'Bearer sk-test')
  assert.equal(call.headers['api-key'], 'azure-key')
  assert.equal(call.body.reasoning_effort, 'low')
  assert.equal(call.body.model, 'gpt-4.1')
  assert.equal(call.body.stream, true)
  assert.notDeepEqual(call.body.messages, [])
})

test('a custom server error names the server, and an unreachable one mentions CORS', async () => {
  const config = { provider: 'openai-compatible' as const, baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'llama3.2' }
  const input = { messages: [{ role: 'user', content: 'hi' }], config, forwardedProps: {}, threadId: 't1', runId: 'r1' }

  captureFetch(() => new Response('', { status: 502 }))
  await assert.rejects(collectAssistantText(providerChatStream(input)), /localhost:11434 request failed \(502\)/)

  globalThis.fetch = (async () => { throw new TypeError('Failed to fetch') }) as typeof fetch
  await assert.rejects(collectAssistantText(providerChatStream(input)), /Could not reach localhost:11434.*CORS/)
})

test('an assistant turn with no text is not sent to the provider', async () => {
  const calls = captureFetch()
  await collectAssistantText(providerChatStream({
    messages: [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: '' },
      { role: 'user', content: 'second' },
    ],
    config: { provider: 'openrouter', apiKey: 'k', model: 'openai/gpt-4.1-mini' },
    forwardedProps: {},
    threadId: 't1',
    runId: 'r1',
  }))
  const sent = (calls[0]!.body.messages as Array<{ role: string; content: string }>).filter((message) => message.role !== 'system')
  assert.deepEqual(sent.map((message) => message.role), ['user', 'user'])
})
