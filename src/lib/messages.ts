import type { UIMessage } from '@tanstack/ai-react'
import type { ChatMessage } from '@/types'
import { parseCitations, sameCitations } from './citations.ts'

export function textOf(message: UIMessage | undefined): string {
  if (!message) return ''
  return message.parts
    .map((part) => (part.type === 'text' ? part.content : ''))
    .join('')
}

export function toUIMessages(messages: ChatMessage[]): UIMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: [{ type: 'text' as const, content: message.content }],
    createdAt: new Date(message.createdAt),
    metadata:
      message.kind === 'drop-summary'
        ? { kind: 'drop-summary', quote: message.quote, sourceThreadId: message.sourceThreadId, citations: message.citations }
        : message.citations
          ? { citations: message.citations }
          : undefined,
  }))
}

export function fromUIMessages(messages: UIMessage[]): ChatMessage[] {
  return messages.flatMap((message) => {
    if (message.role !== 'user' && message.role !== 'assistant') return []
    const kind =
      message.metadata?.kind === 'drop-summary' ? 'drop-summary' : 'message'
    const citations = parseCitations(message.metadata?.citations)
    return [
      {
        id: message.id,
        role: message.role,
        content: textOf(message),
        createdAt: message.createdAt?.getTime() ?? Date.now(),
        kind,
        quote:
          typeof message.metadata?.quote === 'string'
            ? message.metadata.quote
            : undefined,
        sourceThreadId:
          typeof message.metadata?.sourceThreadId === 'string'
            ? message.metadata.sourceThreadId
            : undefined,
        ...(citations ? { citations } : {}),
      } satisfies ChatMessage,
    ]
  })
}

export function sameTranscript(a: ChatMessage[], b: ChatMessage[]) {
  if (a.length !== b.length) return false
  return a.every((message, index) => {
    const other = b[index]
    return (
      message.id === other.id &&
      message.content === other.content &&
      message.role === other.role &&
      (message.kind ?? 'message') === (other.kind ?? 'message') &&
      sameCitations(message.citations, other.citations)
    )
  })
}
