import { fetchServerSentEvents, type ConnectConnectionAdapter } from '@tanstack/ai-react'
import { EventType, type StreamChunk } from '@tanstack/ai'
import {
  DEFAULT_OPENROUTER_MODEL,
  loadProviderConfig,
  providerRequestHeaders,
  type ClientProviderConfig,
} from './provider.ts'
import { mockChatStream, textFromMessage } from '../../shared/mock-stream.ts'
import { buildSystemPrompts } from '../../shared/system-prompts.ts'
import { clearRunCitations } from './citations.ts'

export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'
export const OPENROUTER_APP_TITLE = 'TreeChat'

export type ChatBackend = 'openrouter' | 'local-api' | 'mock'

export type OpenAIChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

type RunChatInput = {
  messages: unknown[]
  data?: Record<string, unknown>
  forwardedProps?: Record<string, unknown>
  threadId: string
  runId: string
  signal?: AbortSignal
}

const localChatConnection = fetchServerSentEvents('/api/chat', () => ({
  headers: providerRequestHeaders(),
}))

let localApiProbe: Promise<boolean> | null = null

export function resetLocalChatApiProbe() {
  localApiProbe = null
}

export function hasLocalChatApi(): Promise<boolean> {
  if (!localApiProbe) localApiProbe = probeLocalChatApi()
  return localApiProbe
}

async function probeLocalChatApi(): Promise<boolean> {
  try {
    const response = await fetch('/api/status', { method: 'GET' })
    return response.ok
  } catch {
    return false
  }
}

export async function resolveChatBackend(
  config: ClientProviderConfig | null = loadProviderConfig(),
): Promise<ChatBackend> {
  if (config?.apiKey) return 'openrouter'
  if (await hasLocalChatApi()) return 'local-api'
  return 'mock'
}

export function openRouterHeaders(
  config: ClientProviderConfig,
  origin = defaultOrigin(),
): Record<string, string> {
  return {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': origin,
    'X-Title': OPENROUTER_APP_TITLE,
  }
}

export function openRouterRequestBody(
  config: ClientProviderConfig,
  messages: OpenAIChatMessage[],
  sessionId?: string,
): {
  model: string
  messages: OpenAIChatMessage[]
  stream: true
  temperature?: number
  max_tokens?: number
  session_id?: string
} {
  const body: {
    model: string
    messages: OpenAIChatMessage[]
    stream: true
    temperature?: number
    max_tokens?: number
    session_id?: string
  } = {
    model: config.model.trim() || DEFAULT_OPENROUTER_MODEL,
    messages,
    stream: true,
  }
  if (typeof config.temperature === 'number') body.temperature = config.temperature
  if (typeof config.maxTokens === 'number') body.max_tokens = config.maxTokens
  if (sessionId) body.session_id = sessionId.slice(0, 256)
  return body
}

function defaultOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }
  return 'https://akarshgopal.github.io/treechat'
}

export function toOpenAIChatMessages(messages: unknown[]): OpenAIChatMessage[] {
  const out: OpenAIChatMessage[] = []
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue
    const role = (message as Record<string, unknown>).role
    if (role !== 'user' && role !== 'assistant' && role !== 'system') continue
    out.push({ role, content: textFromMessage(message) })
  }
  return out
}

export function buildOpenRouterMessages(
  messages: unknown[],
  forwardedProps: Record<string, unknown> = {},
): OpenAIChatMessage[] {
  const system = buildSystemPrompts(forwardedProps).map((content) => ({
    role: 'system' as const,
    content,
  }))
  return [...system, ...toOpenAIChatMessages(messages)]
}

export function contentDeltaFromOpenAIData(payload: string): string | null {
  const trimmed = payload.trim()
  if (!trimmed || trimmed === '[DONE]') return null
  try {
    const parsed = JSON.parse(trimmed) as {
      choices?: Array<{ delta?: { content?: unknown } }>
    }
    const content = parsed.choices?.[0]?.delta?.content
    return typeof content === 'string' && content.length > 0 ? content : null
  } catch {
    return null
  }
}

function mergeForwarded(
  data?: Record<string, unknown>,
  forwardedProps?: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(forwardedProps ?? {}), ...(data ?? {}) }
}

function now() {
  return Date.now()
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

function finishStopped(
  messageId: string,
  threadId: string,
  runId: string,
): StreamChunk[] {
  return [
    { type: EventType.TEXT_MESSAGE_END, messageId, timestamp: now() },
    {
      type: EventType.RUN_FINISHED,
      threadId,
      runId,
      timestamp: now(),
      outcome: { type: 'success' },
    },
  ]
}

async function* readSseDataLines(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const data = frame.split(/\r?\n/).filter((entry) => entry.startsWith('data:')).map((line) => line.replace(/^data: ?/, '')).join('\n')
        if (data) yield data
      }
    }
    buffer += decoder.decode()
    const trailing = buffer.split(/\r?\n/).filter((entry) => entry.startsWith('data:')).map((line) => line.replace(/^data: ?/, '')).join('\n')
    if (trailing) yield trailing
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function errorMessageFromOpenRouter(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string } | string
      message?: string
    }
    if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error
    if (
      parsed.error &&
      typeof parsed.error === 'object' &&
      typeof parsed.error.message === 'string' &&
      parsed.error.message.trim()
    ) {
      return parsed.error.message
    }
    if (typeof parsed.message === 'string' && parsed.message.trim()) {
      return parsed.message
    }
  } catch {
    // fall through
  }
  const trimmed = body.trim()
  if (trimmed && trimmed.length < 280) return trimmed
  return `OpenRouter request failed (${status})`
}

export async function* openRouterChatStream(input: {
  messages: unknown[]
  config: ClientProviderConfig
  forwardedProps?: Record<string, unknown>
  threadId: string
  runId: string
  signal?: AbortSignal
}): AsyncGenerator<StreamChunk> {
  const { config, threadId, runId, signal } = input
  const messageId = crypto.randomUUID()
  const openaiMessages = buildOpenRouterMessages(
    input.messages,
    input.forwardedProps ?? {},
  )

  yield { type: EventType.RUN_STARTED, threadId, runId, timestamp: now() }

  let response: Response
  try {
    response = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: openRouterHeaders(config),
      body: JSON.stringify(openRouterRequestBody(config, openaiMessages,
        typeof input.forwardedProps?.cacheSessionId === 'string' ? input.forwardedProps.cacheSessionId : threadId,
      )),
      signal,
    })
  } catch (error) {
    if (isAbortError(error, signal)) return
    yield {
      type: EventType.RUN_ERROR,
      message: error instanceof Error ? error.message : 'OpenRouter request failed',
      code: 'network',
      timestamp: now(),
    }
    return
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    yield {
      type: EventType.RUN_ERROR,
      message: errorMessageFromOpenRouter(response.status, body),
      code: String(response.status),
      timestamp: now(),
    }
    return
  }

  yield {
    type: EventType.TEXT_MESSAGE_START,
    messageId,
    role: 'assistant',
    timestamp: now(),
  }

  if (!response.body) {
    yield { type: EventType.RUN_ERROR, message: 'The provider returned no response. Try regenerating.', code: 'empty_response', timestamp: now() }
    return
  }

  let receivedText = false
  try {
    for await (const payload of readSseDataLines(response.body, signal)) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      if (payload.trim() === '[DONE]') break
      let event: { error?: unknown; choices?: Array<{ finish_reason?: string }> } | undefined
      try { event = JSON.parse(payload) } catch { /* Ignore non-JSON heartbeat frames. */ }
      if (event?.error || event?.choices?.[0]?.finish_reason === 'error') {
        yield { type: EventType.RUN_ERROR, message: event.error ? errorMessageFromOpenRouter(response.status, payload) : 'The provider stopped with an error. Try regenerating.', code: 'provider', timestamp: now() }
        return
      }
      const delta = contentDeltaFromOpenAIData(payload)
      if (!delta) continue
      receivedText = true
      yield {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta,
        timestamp: now(),
      }
    }
  } catch (error) {
    if (isAbortError(error, signal)) {
      for (const chunk of finishStopped(messageId, threadId, runId)) yield chunk
      return
    }
    yield {
      type: EventType.RUN_ERROR,
      message: error instanceof Error ? error.message : 'OpenRouter stream failed',
      code: 'stream',
      timestamp: now(),
    }
    return
  }

  if (!receivedText) {
    yield { type: EventType.RUN_ERROR, message: 'The provider returned no text. Try regenerating or choose another model.', code: 'empty_response', timestamp: now() }
    return
  }
  yield { type: EventType.TEXT_MESSAGE_END, messageId, timestamp: now() }
  yield {
    type: EventType.RUN_FINISHED,
    threadId,
    runId,
    timestamp: now(),
    outcome: { type: 'success' },
  }
}

export async function* runChat(input: RunChatInput): AsyncGenerator<StreamChunk> {
  clearRunCitations(input.threadId)
  const config = loadProviderConfig()
  const forwardedProps = mergeForwarded(input.data, input.forwardedProps)
  const backend = await resolveChatBackend(config)

  if (backend === 'openrouter' && config) {
    yield* openRouterChatStream({
      messages: input.messages,
      config,
      forwardedProps,
      threadId: input.threadId,
      runId: input.runId,
      signal: input.signal,
    })
    return
  }

  if (backend === 'local-api') {
    yield* localChatConnection.connect(
      input.messages as never,
      forwardedProps,
      input.signal,
      {
        threadId: input.threadId,
        runId: input.runId,
        forwardedProps,
      },
    )
    return
  }

  yield* mockChatStream({
    messages: input.messages,
    threadId: input.threadId,
    runId: input.runId,
    quote:
      typeof forwardedProps.quote === 'string' ? forwardedProps.quote : undefined,
    signal: input.signal,
  })
}

export async function collectAssistantText(
  stream: AsyncIterable<StreamChunk>,
): Promise<string> {
  let text = ''
  for await (const chunk of stream) {
    if (chunk.type === EventType.TEXT_MESSAGE_CONTENT && chunk.delta) {
      text += chunk.delta
    } else if (chunk.type === EventType.RUN_ERROR) {
      throw new Error(chunk.message || 'Chat request failed')
    }
  }
  return text.trim()
}

export const treeChatConnection: ConnectConnectionAdapter = {
  async *connect(messages, data, abortSignal, runContext) {
    yield* runChat({
      messages,
      data,
      forwardedProps: runContext?.forwardedProps,
      threadId: runContext?.threadId ?? crypto.randomUUID(),
      runId: runContext?.runId ?? crypto.randomUUID(),
      signal: abortSignal,
    })
  },
}
