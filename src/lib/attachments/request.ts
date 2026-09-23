import type { Attachment } from '@/types'
import { attachmentLabel, parseAttachments } from './parse.ts'
import { getAttachment, type StoredAttachment } from './store.ts'

/**
 * Images from the last few messages are sent as images; older ones are named
 * with their one-time description instead, so a long chat does not pay for
 * every screenshot on every turn.
 */
export const RESEND_RECENT_MESSAGES = 4

export type RequestImage = { url: string; label: string }

/** A message ready for a request: its text plus any images to send with it. */
export type PreparedMessage = Record<string, unknown> & {
  role: string
  parts: Array<{ type: 'text'; content: string }>
  requestImages?: RequestImage[]
}

type Load = (id: string) => Promise<StoredAttachment | undefined>

function textOf(message: Record<string, unknown>): string {
  if (Array.isArray(message.parts)) {
    return message.parts
      .map((part) => (part && typeof part === 'object' && (part as { type?: unknown }).type === 'text' ? String((part as { content?: unknown }).content ?? '') : ''))
      .join('')
  }
  return typeof message.content === 'string' ? message.content : ''
}

function attachmentsOf(message: Record<string, unknown>): Attachment[] {
  const metadata = message.metadata as Record<string, unknown> | undefined
  return parseAttachments(metadata?.attachments) ?? []
}

function fileBlock(attachment: Attachment, text: string): string {
  return `Attached file ${attachment.name}:\n\`\`\`\n${text}\n\`\`\``
}

function imageNote(attachment: Attachment, stored: StoredAttachment | undefined, reason: string): string {
  const description = stored?.description?.trim()
  return description
    ? `[Image: ${attachmentLabel(attachment)} — ${description}]`
    : `[Image: ${attachmentLabel(attachment)} — ${reason}]`
}

/**
 * Resolve every message's attachments from storage. Text files become quoted
 * blocks in the text; images become `requestImages` when `imagesInline` (a
 * vision request) and the message is recent, otherwise a bracketed note.
 * `anchorAttachments` (a branch's source message) join the first user turn.
 * Missing files are named, never fatal.
 */
export async function prepareRequestMessages(
  messages: unknown[],
  options: { imagesInline: boolean; anchorAttachments?: Attachment[]; load?: Load },
): Promise<{ messages: PreparedMessage[]; sentImages: Attachment[] }> {
  const load = options.load ?? getAttachment
  const sentImages: Attachment[] = []
  const records = messages.filter((message): message is Record<string, unknown> => Boolean(message) && typeof message === 'object')
  const firstUser = records.findIndex((message) => message.role === 'user')
  const out: PreparedMessage[] = []

  for (const [index, message] of records.entries()) {
    const own = attachmentsOf(message)
    const inherited = index === firstUser ? options.anchorAttachments ?? [] : []
    const text = textOf(message)
    if (own.length === 0 && inherited.length === 0) {
      out.push({ ...message, role: String(message.role), parts: [{ type: 'text', content: text }] })
      continue
    }
    const recent = index >= records.length - RESEND_RECENT_MESSAGES
    const blocks: string[] = []
    const images: RequestImage[] = []
    for (const [position, attachment] of [...inherited, ...own].entries()) {
      const fromSource = position < inherited.length
      let stored: StoredAttachment | undefined
      try {
        stored = await load(attachment.id)
      } catch {
        stored = undefined
      }
      if (!stored) {
        blocks.push(`[${attachment.kind === 'image' ? 'Image' : 'File'}: ${attachment.name} — no longer available]`)
        continue
      }
      if (attachment.kind === 'text') {
        blocks.push(fileBlock(attachment, stored.data))
      } else if (options.imagesInline && (recent || fromSource)) {
        images.push({ url: stored.data, label: attachmentLabel(attachment) })
        sentImages.push(attachment)
      } else {
        blocks.push(imageNote(attachment, stored, options.imagesInline ? 'shown earlier' : 'this model only reads text'))
      }
    }
    if (inherited.length > 0 && images.length > 0) {
      blocks.unshift('(Images from the message this branch grew from are attached.)')
    }
    const content = [text, ...blocks].filter((part) => part.trim()).join('\n\n')
    out.push({
      ...message,
      role: String(message.role),
      parts: [{ type: 'text', content }],
      ...(images.length > 0 ? { requestImages: images } : {}),
    })
  }
  return { messages: out, sentImages }
}
