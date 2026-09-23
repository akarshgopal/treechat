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
    return `The exploration on ${q} stays connected to its source passage. A takeaway carries the useful conclusion back to the parent, with a link to revisit the full exploration.`
  }

  if (quote) {
    if (text.includes('deep') || text.includes('nest') || text.includes('again')) {
      return `You can branch from here too — this thread is a conversation like any other, so select a passage in it and fork again. Each level carries upstream context. Past two levels, choose "Expand branch" for a full-width view and "Back to passage" to return to the source.`
    }
    if (text.includes('composer') || text.includes('post')) {
      return `This composer posts only into this thread. Every thread has its own — the one at the bottom belongs to whichever thread holds the frame. The quote «${quote}» is this thread's anchor, and Esc walks back up one level.`
    }
    return `Staying on the branch from «${quote}». This exploration includes context from the conversation above. Expand gives it room to grow, and Back to passage returns you to the source. When you find something useful, Bring back lets you review and edit a takeaway before adding it.`
  }

  if (text.includes('select') || text.includes('shortcut') || text.includes('chip')) {
    return 'Select any span in any message, in any thread. Choose "Branch" — or press ⌘⇧B / Ctrl+Shift+B — to open a question beside the passage. Send to start the branch, or cancel without creating one. You can also use the button below each message.'
  }

  if (text.includes('pip') || text.includes('underline') || text.includes('closed') || text.includes('hover')) {
    return 'Closed branches stay quiet: a moss underline on the span, and a pill on the hairline below the message carrying the quote and a reply count. Click either to open the thread in place. Several branches can share one passage — then the underline doubles and the pill numbers them.'
  }

  if (text.includes('composer') || text.includes('main') || text.includes('thread')) {
    return 'Each composer names its reply destination. The one at the bottom belongs to the conversation holding the frame; an inline branch has its own. Expand opens a focused view with its source pinned above, and Back to passage returns you to that source.'
  }

  if (text.includes('discard') || text.includes('chat') || text.includes('conversation')) {
    return 'Choose Expand to focus on a branch, or Bring back to review and edit a takeaway. The takeaway links to the exploration, and Undo removes just the takeaway. Discard is in the branch options menu and asks before removing the branch and its descendants.'
  }

  if (text.includes('what is') || text.includes('treechat') || text.includes('how do')) {
    return 'TreeChat treats a chat as an actual tree. Every thread is a full conversation; the root one is just the thread with no parent. Highlight a passage to grow a side-thread, branch that branch if you want, and each level carries the chain above it as context. The whole tree persists in localStorage.'
  }

  return `This is a demo reply — TreeChat has no model connected yet, so it can't answer that. Add an OpenRouter key in Settings for real answers. You can still try branching: select a phrase here and press ⌘⇧B / Ctrl+Shift+B.`
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
  } catch (error) {
    const aborted =
      signal?.aborted ||
      (error instanceof DOMException && error.name === 'AbortError') ||
      (error instanceof Error && error.name === 'AbortError')
    if (!aborted) throw error
    // Keep whatever already streamed; do not surface abort as a run error.
    yield { type: EventType.TEXT_MESSAGE_END, messageId, timestamp: now() }
    yield {
      type: EventType.RUN_FINISHED,
      threadId,
      runId,
      timestamp: now(),
      outcome: { type: 'success' },
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
