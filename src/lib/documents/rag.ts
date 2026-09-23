import { EventType, type StreamChunk } from '@tanstack/ai'
import { textFromMessage } from '../../../shared/mock-stream.ts'
import { recordRunCitations } from '../citations.ts'
import type { Citation } from '../../types.ts'
import { getEmbedder } from './active-embedder.ts'
import type { Embedder } from './embedder.ts'
import { documentCitations, documentsPrompt, retrieve } from './retrieve.ts'

/** The ids a chat sends in `forwardedProps.documentIds`, cleaned up. */
export function documentIdsFrom(forwardedProps: Record<string, unknown>): string[] {
  const value = forwardedProps.documentIds
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && id.length > 0) : []
}

/** Search with what the person just asked, plus the passage a branch is about. */
export function retrievalQuery(messages: unknown[], forwardedProps: Record<string, unknown>): string {
  let question = ''
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as Record<string, unknown> | undefined
    if (message?.role !== 'user') continue
    question = textFromMessage(message)
    break
  }
  const quote = typeof forwardedProps.quote === 'string' ? forwardedProps.quote.trim() : ''
  return [question.trim(), quote].filter(Boolean).join('\n')
}

/**
 * Before a request: when the chat has documents attached, find the excerpts
 * that match, hand them to the model as a `documents` system section (see
 * `buildSystemPrompts`), and record them as the reply's citations. Any failure
 * is logged and the request goes on without documents.
 */
export async function withDocuments(input: {
  messages: unknown[]
  forwardedProps: Record<string, unknown>
  threadId: string
  embedder?: Embedder
}): Promise<{ forwardedProps: Record<string, unknown>; citations: Citation[] }> {
  // The ids are for this step only; providers never need them.
  const rest = { ...input.forwardedProps }
  delete rest.documentIds
  const unchanged = { forwardedProps: rest, citations: [] }
  const ids = documentIdsFrom(input.forwardedProps)
  if (ids.length === 0) return unchanged
  try {
    const query = retrievalQuery(input.messages, input.forwardedProps)
    const hits = await retrieve(query, ids, { embedder: input.embedder ?? getEmbedder() })
    if (hits.length === 0) return unchanged
    const citations = documentCitations(hits)
    recordRunCitations(input.threadId, citations)
    return { forwardedProps: { ...rest, documents: documentsPrompt(hits) }, citations }
  } catch (error) {
    console.warn('TreeChat: document retrieval failed; answering without documents', error)
    return unchanged
  }
}

/**
 * Demo replies ignore system prompts, so say which excerpts matched — with
 * markers — to show retrieval working without a model.
 */
export async function* withDocumentNote(
  stream: AsyncIterable<StreamChunk>,
  citations: Citation[],
): AsyncGenerator<StreamChunk> {
  if (citations.length === 0) {
    yield* stream
    return
  }
  const list = citations
    .map((citation) => `- ${citation.title}${citation.locator ? `, ${citation.locator}` : ''} [${citation.id}]`)
    .join('\n')
  for await (const chunk of stream) {
    if (chunk.type === EventType.TEXT_MESSAGE_END) {
      yield {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: chunk.messageId,
        delta: `\n\nMatching excerpts from your documents:\n${list}`,
        timestamp: Date.now(),
      }
    }
    yield chunk
  }
}
