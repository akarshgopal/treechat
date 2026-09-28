import { EventType, type StreamChunk } from '@tanstack/ai'
import type { Citation } from '@/types'

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
  /** A model asked for by name ("Try another model"): the demo says so. */
  model?: string
}

/**
 * CUSTOM stream event carrying the demo reply's sources; `runChat` records it
 * for the thread and keeps it out of the chat engine.
 */
export const CITATIONS_EVENT = 'treechat.citations'

const MOCK_WEB_CITATIONS: Citation[] = [
  {
    id: '1',
    kind: 'web',
    title: 'Branching conversations keep tangents in place',
    url: 'https://example.com/branching-conversations',
    snippet: 'A branch stays attached to the passage that prompted it',
  },
  {
    id: '2',
    kind: 'web',
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

  // "What did I learn?": answered from the outline in the request, which may
  // quote anything (code, attachments), so it is recognised first.
  if (text.startsWith('summarize what i learned in this treechat exploration')) return learnReply(userText)

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

  // The takeaway dialog's draft request.
  if (text.startsWith('summarize this treechat branch')) {
    const q = quote ? `“${quote}”` : 'this passage'
    return `The branch on ${q} kept its tangent beside the passage it came from, so the main conversation stayed readable; this short takeaway is the part worth keeping, and it links back to the full branch.`
  }

  if (quote) return lensReply(userText, quote)

  const topic = TOPICS.find(({ match }) => match.test(text))
  if (topic) return topic.reply

  return 'This is a demo reply — no model is connected, so TreeChat can’t really answer that. Add an OpenRouter key in Settings for real answers. Meanwhile, select a phrase in this reply and tap a lens to see branching work.'
}

/**
 * A summary built from the request's `TITLE:` / `BRANCH:` / `TAKEAWAY:`
 * lines, so the demo shows the real shape: a lead, then what each branch
 * concluded, then what else was looked at.
 */
function learnReply(request: string): string {
  const title = request.match(/^TITLE: (.+)$/m)?.[1]?.trim() ?? 'this exploration'
  const branches: Array<{ title: string; takeaway?: string }> = []
  for (const line of request.split('\n')) {
    const branch = line.match(/^\s*BRANCH: (.+)$/)
    if (branch) branches.push({ title: branch[1]!.trim() })
    const takeaway = line.match(/^TAKEAWAY: (.+)$/)
    if (takeaway && branches.length > 0) branches[branches.length - 1]!.takeaway = takeaway[1]!.trim()
  }
  const kept = branches.filter((branch) => branch.takeaway)
  const rest = branches.filter((branch) => !branch.takeaway)
  const count = branches.length
  const lead = count === 0
    ? `This demo summary covers “${title}”, which has no branches yet. With an OpenRouter key, the model reads the conversation and says what it found.`
    : `This demo summary covers “${title}” and its ${count} ${count === 1 ? 'branch' : 'branches'}. With an OpenRouter key, the model reads every transcript and says what the exploration found; here, the takeaways you brought back are listed as they are.`
  const parts = [lead]
  if (kept.length > 0) parts.push(`## Takeaways\n${kept.map((branch) => `- **${branch.title}** ${branch.takeaway}`).join('\n')}`)
  if (rest.length > 0) parts.push(`## Also explored\n${rest.map((branch) => `- ${branch.title}`).join('\n')}`)
  return parts.join('\n\n')
}

/**
 * Demo replies in a branch. Each lens shows a different side of TreeChat, so
 * trying them all is a tour. Questions come from `lensQuestion`.
 */
function lensReply(question: string, quote: string): string {
  const q = `“${quote}”`
  if (/^explain “/i.test(question)) {
    return `**${q}** is now the anchor of this branch. A branch is a side conversation about one passage: it opens in its own lane, sees the conversation above it as context, and never pushes the main thread out of the way. The dot in the margin and the underline on the passage lead back here later. When something here is worth keeping, Bring back lets you review and edit a takeaway before adding it.`
  }
  if (/^give a concrete example of “/i.test(question)) {
    return `Say a reply about databases mentions a “covering index” in passing. Instead of derailing the main answer, you select the phrase, tap **Explain**, and read the explanation in a lane beside it — the main reply stays exactly where it was. That is what just happened here with ${q}. With an OpenRouter key, this lane would give a real example.`
  }
  if (/^what's the strongest case against “/i.test(question)) {
    return `The strongest case against ${q}: every branch is one more thread to keep track of. A few tangents are easier to follow side by side than scrolled away, but a dozen would be clutter. That is why older lanes fold into strips, why **Bring back** condenses a branch into a takeaway, and why **Discard branch** comes with Undo.`
  }
  if (/^say “.*” more simply$/i.test(question)) {
    return `Simpler: ask a side question about exactly this bit — ${q} — without losing your place in the main answer.`
  }
  if (/^go deeper on “/i.test(question)) {
    return `Going deeper on ${q}: a branch is a full conversation, so you can select a passage here and branch again, to any depth. Each branch sends the model the passage it grew from plus the conversation above it — the nearest levels in full, older ones summarized once they get long — so answers stay on topic without resending everything. When lanes no longer fit side by side, the older ones fold into strips on the left.`
  }
  return `With an OpenRouter key, this branch would answer your question about ${q}, with the conversation above as context. This is a demo reply; until then, try a lens on any passage — Explain, Example, Challenge, Simpler and Deeper each show a different part of TreeChat.`
}

/** Demo answers about TreeChat itself, matched by keyword, first match wins. */
const TOPICS: Array<{ match: RegExp; reply: string }> = [
  {
    match: /takeaway|bring (it )?back|merge/,
    reply: 'When a branch turns up something useful, choose **Bring back**: TreeChat drafts a short takeaway, you edit it, and it is added to the conversation the branch came from, linked back to the full branch. Undo removes just the takeaway.',
  },
  {
    match: /long|summar|context|memory|forget/,
    reply: 'Long threads stay usable. Once a thread’s older messages grow past about 8k tokens, TreeChat folds them into a running summary in the background and sends that plus the recent turns. A divider in the thread shows where the summary takes over; click it to read it. Branches get their parent’s summary plus the full turns before their passage.',
  },
  {
    match: /document|pdf|rag|notes/,
    reply: 'Add PDFs, Markdown or text files under **Documents** in the sidebar, or drop them anywhere. They are indexed in your browser; each question sends only the few excerpts that match, numbered so the reply can cite them, and a citation opens its passage beside the reply. Nothing is uploaded anywhere else.',
  },
  {
    match: /source|cite|citation|web|search|internet/,
    reply: 'Tap **Source?** on any passage, or the globe beside a composer, and that thread’s replies search the web and cite what they find. Numbered chips open each source in a lane beside the reply, with the cited passage highlighted. With a key, each search adds a small OpenRouter fee.',
  },
  {
    match: /image|screenshot|photo|paste|attach|file/,
    reply: 'Paste a screenshot, drop an image or text file on a composer, or use the paperclip. Images are resized in your browser and sent to models that can read them; if the chosen model cannot, TreeChat says so and offers one that can.',
  },
  {
    match: /export|import|backup|another (browser|device)|sync/,
    reply: 'Chats live only in this browser. **Export chats** in Settings (or Ctrl/⌘+K) downloads everything, pasted images included, as one JSON file; **Import chats…** adds them in another browser. Documents are not included.',
  },
  {
    match: /api key|\bkey\b|model|cost|price|pay|usage|openrouter|token/,
    reply: 'TreeChat has no server: add your own OpenRouter key in Settings and replies come straight from the model you pick — search them by name, with prices shown. Settings shows what the key has spent, and each reply shows its tokens and cost. Use a key with a credit limit.',
  },
  {
    match: /undo|delete|discard|remove/,
    reply: '**Discard branch** and **Delete chat** act at once and offer Undo for a few seconds, so nothing needs an “are you sure?”. Rewriting an earlier message that later turns or branches depend on still asks first.',
  },
  {
    match: /shortcut|keyboard|hotkey|⌘|ctrl/,
    reply: '**Ctrl/⌘+K** opens the command palette: chats, branches and actions. With a passage selected, just start typing to ask about it, or press **Ctrl/⌘+Shift+B**. **Esc** stops a reply, closes a source, or goes back from a branch. **Ctrl/⌘+\\** folds the sidebar.',
  },
  {
    match: /branch|select|lens|highlight|tangent|side/,
    reply: 'Select any words in any reply. A bar appears with **Explain**, **Example**, **Source?**, **Challenge**, **Simpler** and **Deeper**: tap one and a branch opens beside the passage, already answering. Or just start typing to ask your own question. A dot in the margin marks passages that have branches.',
  },
  {
    match: /what is|treechat|how does|how do|help|hello|\bhi\b/,
    reply: 'TreeChat is a chat you can branch. Select any passage in a reply to ask about it in a side branch that opens right beside it, without losing your place; branch that branch if you like, then bring the useful part back. Everything runs and stays in your browser.',
  },
]

function tokensOf(reply: string): string[] {
  return reply.match(/\s+|\S+/g) ?? [reply]
}

export async function* mockChatStream(input: MockInput): AsyncGenerator<StreamChunk> {
  const { threadId, runId, signal } = input
  const messageId = crypto.randomUUID()
  const answer = input.webSearch ? MOCK_SEARCH_REPLY : craftReply(lastUserText(input.messages), input.quote)
  const reply = input.model ? `Demo answer standing in for ${input.model}. ${answer}` : answer
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
