import { EventType, type StreamChunk } from '@tanstack/ai'

type MockInput = {
  messages: unknown[]
  threadId: string
  runId: string
  quote?: string
  signal?: AbortSignal
  /** Skip token delays (tests). Production always paces. */
  pace?: boolean
  /** Pretend the reply was researched: cite two fake web sources. */
  webSearch?: boolean
}

/**
 * CUSTOM stream event carrying a reply's sources. It survives the local API's
 * SSE hop as well as the in-browser mock; `runChat` records it for the thread
 * and keeps it out of the chat engine.
 */
export const CITATIONS_EVENT = 'treechat.citations'

/** Shaped like `Citation` in src/types.ts (shared code does not import the app). */
export const MOCK_WEB_CITATIONS = [
  {
    id: '1',
    kind: 'web' as const,
    title: 'Branching conversations keep tangents in place',
    url: 'https://example.com/branching-conversations',
    snippet: 'A branch stays attached to the passage that prompted it',
  },
  {
    id: '2',
    kind: 'web' as const,
    title: 'Bringing takeaways back',
    url: 'https://example.com/takeaways',
    locator: 'Section 2',
    snippet: 'a short takeaway returns to the main conversation',
  },
]

const MOCK_SEARCH_REPLY = `Here is what two sources say (demo search results — add an OpenRouter key for real ones). A branch stays attached to the passage that prompted it, so it never scrolls the main thread away [1]. When the branch is done, a short takeaway returns to the main conversation while the branch itself is kept [2]. Open a numbered source to read it beside this lane.`

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

  // Attachments reach the mock as bracketed notes (it cannot see images).
  const images = [...userText.matchAll(/\[Image: ([^\]]+?) — [^\]]*\]/g)].map((match) => match[1])
  const files = [...userText.matchAll(/^Attached file (.+):$/gm)].map((match) => match[1])
  if (images.length > 0 || files.length > 0) {
    const received = [
      images.length > 0 ? `${images.length} image${images.length === 1 ? '' : 's'} (${images.join(', ')})` : '',
      files.length > 0 ? `${files.length} file${files.length === 1 ? '' : 's'} (${files.join(', ')})` : '',
    ].filter(Boolean).join(' and ')
    return `I received ${received}. This is a demo reply, so nothing was actually read — add an OpenRouter key and pick a model that reads images for a real answer.`
  }

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

Select \`quote.trim()\` in that block, or this **bold** phrase, to grow a branch. Links like [TreeChat](https://example.com) open in a new tab.`
  }

  if (text.includes('summarize') || text.includes('merge') || text.includes('drop')) {
    const q = quote ? `“${quote}”` : 'the selected passage'
    return `The exploration on ${q} stays connected to its source passage. A takeaway carries the useful conclusion back to the parent, with a link to revisit the full branch.`
  }

  if (quote) {
    if (text.includes('deep') || text.includes('nest') || text.includes('again')) {
      return `You can branch from here too — this thread is a conversation like any other, so select a passage in it and fork again. Each level carries upstream context. When lanes no longer fit side by side, older ones fold into strips, and the back arrow returns you to the source.`
    }
    if (text.includes('composer') || text.includes('post')) {
      return `This composer posts only into this thread. Every thread has its own — the one at the bottom belongs to whichever thread holds the frame. The quote “${quote}” is this thread's anchor, and Esc walks back up one level.`
    }
    return `Staying on the branch from “${quote}”. This branch includes context from the conversation above and has its own lane and composer; the back arrow returns you to the source. When you find something useful, Bring back lets you review and edit a takeaway before adding it.`
  }

  if (text.includes('select') || text.includes('shortcut') || text.includes('chip')) {
    return 'Select any span in any message, in any thread. Choose "Branch" — or press ⌘⇧B / Ctrl+Shift+B — to open a question beside the passage. Send to start the branch, or cancel without creating one. You can also use the button below each message.'
  }

  if (text.includes('pip') || text.includes('underline') || text.includes('closed') || text.includes('hover')) {
    return 'Closed branches stay quiet: a moss underline on the span, and a pill on the hairline below the message carrying the quote and a reply count. Click either to open the thread in place. Several branches can share one passage — then the underline doubles and the pill numbers them.'
  }

  if (text.includes('composer') || text.includes('main') || text.includes('thread')) {
    return 'Each lane has its own composer at the bottom, so a reply always lands in the thread you type it in. Branches open in lanes to the right, and the back arrow in a branch header returns you to its source passage.'
  }

  if (text.includes('discard') || text.includes('chat') || text.includes('conversation')) {
    return 'Choose Bring back to review and edit a takeaway for the parent conversation. The takeaway links to the branch, and Undo removes just the takeaway. Discard branch, in the branch’s ⋯ menu, removes it and the branches below it — with Undo, in case.'
  }

  if (text.includes('what is') || text.includes('treechat') || text.includes('how do')) {
    return 'TreeChat treats a chat as an actual tree. Every thread is a full conversation; the root one is just the thread with no parent. Highlight a passage to grow a branch, branch that branch if you want, and each level carries the chain above it as context. The whole tree persists in localStorage.'
  }

  return `This is a demo reply — TreeChat has no model connected yet, so it can't answer that. Add an OpenRouter key in Settings for real answers. You can still try branching: select a phrase here and press ⌘⇧B / Ctrl+Shift+B.`
}

function tokensOf(reply: string): string[] {
  return reply.match(/\s+|\S+/g) ?? [reply]
}

export async function* mockChatStream(input: MockInput): AsyncGenerator<StreamChunk> {
  const { threadId, runId, signal } = input
  const messageId = crypto.randomUUID()
  const reply = input.webSearch ? MOCK_SEARCH_REPLY : craftReply(lastUserText(input.messages), input.quote)
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

  if (input.webSearch) {
    yield { type: EventType.CUSTOM, name: CITATIONS_EVENT, value: MOCK_WEB_CITATIONS, timestamp: now() }
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
