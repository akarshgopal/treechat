import type { ChatMessage, Thread, TreeState } from '@/types'

const CONTEXT_TURNS = 6
const CONTEXT_CHARS_PER_TURN = 600

export function threadOf(state: TreeState, threadId: string): Thread | null {
  return state.threads[threadId] ?? null
}

/** Direct children of a thread, oldest first. */
export function childThreads(state: TreeState, threadId: string): Thread[] {
  return Object.values(state.threads)
    .filter((thread) => thread.parentId === threadId)
    .sort((a, b) => a.createdAt - b.createdAt)
}

/** Children anchored to one specific message, oldest first. */
export function childThreadsForMessage(
  state: TreeState,
  threadId: string,
  messageId: string,
): Thread[] {
  return childThreads(state, threadId).filter(
    (thread) => thread.anchor?.messageId === messageId,
  )
}

/** Root first, including the thread itself. Empty if the id is unknown. */
export function pathTo(state: TreeState, threadId: string): Thread[] {
  const path: Thread[] = []
  const seen = new Set<string>()
  let current: Thread | undefined = state.threads[threadId]
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parentId ? state.threads[current.parentId] : undefined
  }
  return path
}

export function depthOf(state: TreeState, threadId: string): number {
  return Math.max(0, pathTo(state, threadId).length - 1)
}

/** A thread and everything beneath it, for cascade discard. */
export function descendantIds(state: TreeState, threadId: string): string[] {
  const out: string[] = []
  const walk = (id: string) => {
    out.push(id)
    for (const child of childThreads(state, id)) walk(child.id)
  }
  walk(threadId)
  return out
}

/** Total replies in a thread and everything beneath it. */
export function subtreeSize(state: TreeState, threadId: string): number {
  return descendantIds(state, threadId).reduce(
    (total, id) => total + (state.threads[id]?.messages.length ?? 0),
    0,
  )
}

/**
 * The run of messages up to (and including) `messageId`, as a transcript.
 * The anchor message is never truncated — it is the one holding the quote.
 */
export function transcriptUpTo(
  messages: ChatMessage[],
  messageId: string,
  turns = CONTEXT_TURNS,
): string {
  const index = messages.findIndex((message) => message.id === messageId)
  if (index < 0) return ''
  const window = messages.slice(Math.max(0, index + 1 - turns), index + 1)
  return window
    .map((message, position) => {
      const isAnchor = position === window.length - 1
      const text =
        isAnchor || message.content.length <= CONTEXT_CHARS_PER_TURN
          ? message.content
          : `${message.content.slice(0, CONTEXT_CHARS_PER_TURN)}…`
      return `${message.role}: ${text}`
    })
    .join('\n\n')
}

/**
 * Everything upstream of a thread: for each ancestor, the turns leading to the
 * passage that was branched on, then the quote itself — walked from the root
 * down. This is what makes a nested thread legible to the model; a quote three
 * levels deep is meaningless without the chain that produced it.
 */
export function threadContext(
  state: TreeState,
  threadId: string,
  turnsPerLevel = CONTEXT_TURNS,
): string {
  const path = pathTo(state, threadId)
  if (path.length <= 1) return ''

  const sections: string[] = []
  for (let i = 0; i < path.length - 1; i += 1) {
    const thread = path[i]
    const child = path[i + 1]
    const anchor = child.anchor
    if (!anchor) continue
    const label =
      i === 0 ? 'Main thread' : `Branch (depth ${i}) on «${thread.anchor?.quote ?? ''}»`
    const transcript = transcriptUpTo(thread.messages, anchor.messageId, turnsPerLevel)
    sections.push(
      `${label}:\n${transcript}\n\n→ the user selected «${anchor.quote}» here and branched.`,
    )
  }
  return sections.join('\n\n---\n\n')
}
