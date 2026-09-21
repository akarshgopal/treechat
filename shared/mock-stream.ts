import { EventType, type StreamChunk } from '@tanstack/ai'

type MockInput = {
  messages: unknown[]
  threadId: string
  runId: string
  quote?: string
  signal?: AbortSignal
  /** Skip token delays (tests). Production always paces. */
  pace?: boolean
}

function inNodeTest() {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process
  return Boolean(proc?.env?.NODE_TEST_CONTEXT)
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

export function textFromMessage(message: unknown): string {
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

  if (
    text.includes('```') ||
    /\b(code (sample|block|fence|example)|syntax highlight|markdown)\b/.test(text)
  ) {
    return `A fenced block renders with a language label and a copy button:

\`\`\`ts
function branch(quote: string) {
  return quote.trim()
}
\`\`\`

Select \`quote.trim()\` in that block, or this **bold** phrase, to fork a side-thread. Links like [TreeChat](https://example.com) open in a new tab.`
  }

  if (text.includes('summarize') || text.includes('merge') || text.includes('drop')) {
    const q = quote ? `«${quote}»` : 'the selected passage'
    return `Merged up from the branch on ${q}. The tangent stayed pinned to that character range and used its own composer, so it never stole the thread above it. What is left behind is a quiet underline and a pill you can reopen.`
  }

  if (quote) {
    if (text.includes('deep') || text.includes('nest') || text.includes('again')) {
      return `You can branch from here too — this thread is a conversation like any other, so select a passage in it and fork again. Each level carries the whole chain above it as context. Past two levels the cards stop nesting inline and offer "open as chat" instead.`
    }
    if (text.includes('composer') || text.includes('post')) {
      return `This composer posts only into this thread. Every thread has its own — the one at the bottom belongs to whichever thread holds the frame. The quote «${quote}» is this thread's anchor, and Esc walks back up one level.`
    }
    return `Staying on the branch from «${quote}». I can see the whole chain this grew out of, so ask anything about it. Merge up folds a recap into the parent thread, Discard removes this branch and everything under it, and Open as chat gives it the full frame.`
  }

  if (text.includes('select') || text.includes('shortcut') || text.includes('chip')) {
    return 'Select any span in any message, in any thread. A "branch from selection" chip floats over the highlight — or press ⌘⇧B / Ctrl+Shift+B. The new thread is anchored to that character range and stores the quote, so the underline survives as the thread grows.'
  }

  if (text.includes('pip') || text.includes('underline') || text.includes('closed') || text.includes('hover')) {
    return 'Closed branches stay quiet: a moss underline on the span, and a pill on the hairline below the message carrying the quote and a reply count. Click either to open the thread in place. Several branches can share one passage — then the underline doubles and the pill numbers them.'
  }

  if (text.includes('composer') || text.includes('main') || text.includes('thread')) {
    return 'Every thread has its own composer, so there is never a question of where a message lands. The one at the bottom belongs to the thread holding the frame; an expanded branch carries its own inside its card. Open as chat hands the frame to a branch, and the header shows the path back up.'
  }

  if (text.includes('discard') || text.includes('chat') || text.includes('conversation')) {
    return 'Every branch header has three moves: Merge up (a recap lands in the parent thread), Discard (confirm first — it takes any branches growing out of it too), and Open as chat (the branch takes the full frame, with the tree rail beside it).'
  }

  if (text.includes('what is') || text.includes('treechat') || text.includes('how do')) {
    return 'TreeChat treats a chat as an actual tree. Every thread is a full conversation; the root one is just the thread with no parent. Highlight a passage to grow a side-thread, branch that branch if you want, and each level carries the chain above it as context. The whole tree persists in localStorage.'
  }

  return `Noted. This lands in whichever thread you are in — nothing retargets. Select a phrase above and press ⌘⇧B / Ctrl+Shift+B if you want to fork from here.`
}

function tokensOf(reply: string): string[] {
  return reply.match(/\s+|\S+/g) ?? [reply]
}

export async function* mockChatStream(input: MockInput): AsyncGenerator<StreamChunk> {
  const { threadId, runId, signal } = input
  const messageId = crypto.randomUUID()
  const reply = craftReply(lastUserText(input.messages), input.quote)
  const now = () => Date.now()
  const paced = input.pace ?? !inNodeTest()

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
      if (paced) await sleep(16 + Math.min(token.length, 8) * 4, signal)
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
