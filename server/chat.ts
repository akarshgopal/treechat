import {
  chat,
  chatParamsFromRequest,
  toServerSentEventsResponse,
} from '@tanstack/ai'
import {
  getProviderStatus,
  getTextAdapter,
  type RequestEnv,
} from './adapter.ts'
import { mockChatStream } from '../shared/mock-stream.ts'
import { buildSystemPrompts } from '../shared/system-prompts.ts'

export function getStatus(request?: Request | null, env?: RequestEnv) {
  return getProviderStatus(request, env)
}

export async function handleApiRequest(
  request: Request,
  env?: RequestEnv,
): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === '/api/status' && request.method === 'GET') {
    return Response.json(getStatus(request, env))
  }

  if (url.pathname !== '/api/chat') {
    return new Response('Not found', { status: 404 })
  }

  if (request.method === 'GET') {
    return Response.json(getStatus(request, env))
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let params: Awaited<ReturnType<typeof chatParamsFromRequest>>
  try {
    params = await chatParamsFromRequest(request)
  } catch (error) {
    if (error instanceof Response) return error
    const message = error instanceof Error ? error.message : 'Invalid chat request'
    return new Response(message, { status: 400 })
  }

  const abortController = new AbortController()
  request.signal.addEventListener('abort', () => abortController.abort(), {
    once: true,
  })

  const quote =
    typeof params.forwardedProps.quote === 'string'
      ? params.forwardedProps.quote
      : undefined
  const systemPrompts = buildSystemPrompts(params.forwardedProps)
  const adapter = getTextAdapter(request, env)

  if (!adapter) {
    const stream = mockChatStream({
      messages: params.messages,
      threadId: params.threadId,
      runId: params.runId,
      quote,
      webSearch: params.forwardedProps.webSearch === true,
      signal: abortController.signal,
    })
    return toServerSentEventsResponse(stream, { abortController })
  }

  // Web search is browser-only (OpenRouter's web plugin, src/lib/web-search.ts); this local fallback ignores `webSearch`.
  const stream = chat({
    adapter,
    messages: params.messages,
    threadId: params.threadId,
    runId: params.runId,
    systemPrompts,
    abortController,
  })
  return toServerSentEventsResponse(stream, { abortController })
}
