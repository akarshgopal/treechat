import { EventType, type StreamChunk } from '@tanstack/ai'

type MockInput = {
  messages: unknown[]
  threadId: string
  runId: string
  quote?: string
  signal?: AbortSignal
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => resolve(), ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

function textFromMessage(message: unknown): string {
  if (!message || typeof message !== 'object') return ''
  const record = message as Record<string, unknown>
  if (typeof record.content === 'string') return record.content
  if (Array.isArray(record.parts)) {
    return record.parts
      .map((part) => {
        if (!part || typeof part !== 'object') return ''
        const p = part as Record<string, unknown>
        if (p.type === 'text') {
          return String(p.content ?? p.text ?? '')
        }
        return ''
      })
      .join('')
  }
  if (Array.isArray(record.content)) {
    return record.content
      .map((part) => {
        if (!part || typeof part !== 'object') return ''
        const p = part as Record<string, unknown>
        return String(p.text ?? p.content ?? '')
      })
      .join('')
  }
  return ''
}

function lastUserText(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as Record<string, unknown> | undefined
    if (message?.role === 'user') return textFromMessage(message)
  }
  return ''
}

function craftReply(userText: string, quote?: string): string {
  const text = userText.toLowerCase()

  if (text.includes('summarize') || text.includes('drop')) {
    const q = quote ? `«${quote}»` : 'the selected passage'
    return `Dropped from the branch on ${q}. The tangent stayed attached to that character range, used its own composer, and never stole the spine. Closed branches remain as a quiet underline plus a gutter pip you can reopen.`
  }

  if (quote) {
    if (text.includes('composer') || text.includes('post')) {
      return `On this tangent, this composer posts only here — not to the spine. The quote «${quote}» is the anchor. Esc blurs a dirty composer first, then returns you to the trunk.`
    }
    return `Staying on the branch from «${quote}». Ask anything about this passage; Drop summary will fold a short recap onto the spine, Discard removes the tangent, and Open as conversation gives this thread the full frame.`
  }

  if (text.includes('select') || text.includes('shortcut') || text.includes('chip')) {
    return 'Select any span in a message. A Branch chip floats over the highlight — or press ⌘⇧B / Ctrl+Shift+B. The new side-thread is anchored to that character range and stores the quote so the underline survives as the spine grows.'
  }

  if (text.includes('pip') || text.includes('underline') || text.includes('closed') || text.includes('hover')) {
    return 'Closed branches stay quiet: a moss underline on the span, a gutter pip with the reply count. Hover the pip for a preview; click it (or the underline) to open the inline thread. Only one inline branch is open at a time.'
  }

  if (text.includes('composer') || text.includes('banner') || text.includes('spine') || text.includes('main')) {
    return 'The bottom composer always posts to the spine. While an inline branch is open you’ll see “Posting to main · switch to branch” — that switch focuses the branch’s own composer. Conversation view is the exception: its composer posts only to the tangent.'
  }

  if (text.includes('drop') || text.includes('discard') || text.includes('conversation')) {
    return 'Every branch header has three moves: Drop summary into main (a recap lands on the spine), Discard (confirm first), and Open as conversation (full-frame tangent with Back to spine, the quote as context, and Esc to leave).'
  }

  if (text.includes('what is') || text.includes('treechat') || text.includes('how do')) {
    return 'TreeChat treats a chat as a tree. The spine is the trunk. Highlight a passage to grow a side-thread, keep it closed as an underline + pip, or open it inline / as its own conversation. Everything — branches and view mode — persists in localStorage.'
  }

  return `Noted. On the spine this becomes another trunk message; on a branch it stays a tangent. Try selecting a phrase above and pressing ⌘⇧B / Ctrl+Shift+B if you want to fork from here.`
}

function tokensOf(reply: string): string[] {
  return reply.match(/\s+|\S+/g) ?? [reply]
}

export async function* mockChatStream(input: MockInput): AsyncGenerator<StreamChunk> {
  const { threadId, runId, signal } = input
  const messageId = crypto.randomUUID()
  const reply = craftReply(lastUserText(input.messages), input.quote)
  const now = () => Date.now()

  yield { type: EventType.RUN_STARTED, threadId, runId, timestamp: now() }
  yield {
    type: EventType.TEXT_MESSAGE_START,
    messageId,
    role: 'assistant',
    timestamp: now(),
  }

  try {
    for (const token of tokensOf(reply)) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      await sleep(16 + Math.min(token.length, 8) * 4, signal)
      yield {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: token,
        timestamp: now(),
      }
    }
  } catch {
    yield {
      type: EventType.RUN_ERROR,
      message: 'Aborted',
      code: 'aborted',
      timestamp: now(),
    }
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
