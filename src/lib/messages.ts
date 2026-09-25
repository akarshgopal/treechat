import type { UIMessage } from '@tanstack/ai-react'
import type { ChatMessage } from '@/types'
import { parseCitations, sameCitations } from './citations.ts'
import { parseAttachments, sameAttachments } from './attachments/parse.ts'
import { parseUsage, sameUsage } from './usage.ts'

export function textOf(message: UIMessage | undefined): string {
  if (!message) return ''
  return message.parts
    .map((part) => (part.type === 'text' ? part.content : ''))
    .join('')
}

/** What the chat engine carries beside a message's text; undefined when nothing. */
function metadataOf(message: ChatMessage): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {}
  if (message.kind === 'drop-summary') {
    metadata.kind = 'drop-summary'
    metadata.quote = message.quote
    metadata.sourceThreadId = message.sourceThreadId
  }
  if (message.citations) metadata.citations = message.citations
  if (message.attachments) metadata.attachments = message.attachments
  if (message.usage) metadata.usage = message.usage
  return Object.keys(metadata).length > 0 ? metadata : undefined
}

export function toUIMessages(messages: ChatMessage[]): UIMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: [{ type: 'text' as const, content: message.content }],
    createdAt: new Date(message.createdAt),
    metadata: metadataOf(message),
  }))
}

export function fromUIMessages(messages: UIMessage[]): ChatMessage[] {
  return messages.flatMap((message) => {
    if (message.role !== 'user' && message.role !== 'assistant') return []
    const kind =
      message.metadata?.kind === 'drop-summary' ? 'drop-summary' : 'message'
    const citations = parseCitations(message.metadata?.citations)
    const attachments = parseAttachments(message.metadata?.attachments)
    const usage = parseUsage(message.metadata?.usage)
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
        ...(attachments ? { attachments } : {}),
        ...(usage ? { usage } : {}),
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
      sameCitations(message.citations, other.citations) &&
      sameAttachments(message.attachments, other.attachments) &&
      sameUsage(message.usage, other.usage)
    )
  })
}
