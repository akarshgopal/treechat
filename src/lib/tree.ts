import type { ChatMessage, Thread, TreeState } from '@/types'

const CONTEXT_TURNS = 6
const CONTEXT_CHARS_PER_TURN = 480
const CONTEXT_QUOTE_CHARS = 240
const CONTEXT_MAX_ANCESTORS = 4
const CONTEXT_BUDGET = 4200

export const CONTEXT_MAIN = 'MAIN'
export const CONTEXT_QUOTE = 'SELECTED QUOTE'

export function contextBranchLabel(depth: number) {
  return `BRANCH depth ${depth}`
}

export function contextOmittedLabel(count: number) {
  return `[${count} ancestor level${count === 1 ? '' : 's'} omitted]`
}

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

/**
 * Group siblings that hang off the same span. Groups stay in first-seen
 * (oldest-first) order, and members inside a group keep that order.
 */
export function groupThreadsBySpan(threads: Thread[]): Thread[][] {
  const groups: Thread[][] = []
  const indexByKey = new Map<string, number>()
  for (const thread of threads) {
    const key = thread.anchor
      ? `${thread.anchor.start}:${thread.anchor.end}`
      : thread.id
    const existing = indexByKey.get(key)
    if (existing == null) {
      indexByKey.set(key, groups.length)
      groups.push([thread])
    } else {
      groups[existing].push(thread)
    }
  }
  return groups
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

/**
 * How many steps `threadId` is below `ancestorId`. `0` if they are the same
 * thread. `Infinity` if the ancestor is not on the path.
 */
export function depthFrom(
  state: TreeState,
  ancestorId: string,
  threadId: string,
): number {
  const path = pathTo(state, threadId)
  const index = path.findIndex((thread) => thread.id === ancestorId)
  if (index < 0) return Number.POSITIVE_INFINITY
  return path.length - 1 - index
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
 * Parent → child expansions that reveal `threadId` from the root down.
 * Does not include an entry for the thread itself.
 */
export function expansionToReveal(
  state: TreeState,
  threadId: string,
): Record<string, string> {
  const path = pathTo(state, threadId)
  const next: Record<string, string> = {}
  for (let i = 0; i < path.length - 1; i += 1) {
    next[path[i].id] = path[i + 1].id
  }
  return next
}

/**
 * Cycle a same-span set: closed → first → next → … → last → closed.
 * `ids` must already be in stable (oldest-first) order.
 */
export function cycleOpenId(ids: string[], openId: string | null): string | null {
  if (ids.length === 0) return null
  if (openId == null) return ids[0]
  const index = ids.indexOf(openId)
  if (index < 0 || index === ids.length - 1) return null
  return ids[index + 1]
}

export function clipText(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

/**
 * The run of messages up to (and including) `messageId`, as a transcript.
 * The anchor message is never truncated — it is the one holding the quote.
 */
export function transcriptUpTo(
  messages: ChatMessage[],
  messageId: string,
  turns = CONTEXT_TURNS,
  charsPerTurn = CONTEXT_CHARS_PER_TURN,
): string {
  const index = messages.findIndex((message) => message.id === messageId)
  if (index < 0) return ''
  const window = messages.slice(Math.max(0, index + 1 - turns), index + 1)
  return window
    .map((message, position) => {
      const isAnchor = position === window.length - 1
      const text =
        isAnchor || message.content.length <= charsPerTurn
          ? message.content
          : `${message.content.slice(0, charsPerTurn)}…`
      return `${message.role}: ${text}`
    })
    .join('\n\n')
}

function formatAncestorSection(
  depth: number,
  transcript: string,
  quote: string | null,
): string {
  const title = depth === 0 ? CONTEXT_MAIN : contextBranchLabel(depth)
  const body = quote
    ? `«${clipText(quote, CONTEXT_QUOTE_CHARS)}»\n${transcript}`
    : transcript
  return `${title}\n${body}`
}

/**
 * Everything upstream of a thread: a bounded ancestor chain from the root
 * down to the quote this thread is pinned to.
 *
 * Sections are labeled MAIN, BRANCH depth N, then SELECTED QUOTE so the
 * model can see structure instead of a mushy blob. Deep trees keep the root
 * and the nearest ancestors and drop the middle.
 */
export function threadContext(
  state: TreeState,
  threadId: string,
  turnsPerLevel = CONTEXT_TURNS,
): string {
  const path = pathTo(state, threadId)
  if (path.length <= 1) return ''

  const leaf = path[path.length - 1]
  const ancestors = path.slice(0, -1)
  const omitCount = Math.max(0, ancestors.length - CONTEXT_MAX_ANCESTORS)
  const keepTail = CONTEXT_MAX_ANCESTORS - 1
  const keepFrom = omitCount > 0 ? ancestors.length - keepTail : 1

  const sections: string[] = []
  for (let i = 0; i < ancestors.length; i += 1) {
    if (omitCount > 0 && i >= 1 && i < keepFrom) {
      if (i === 1) sections.push(contextOmittedLabel(omitCount))
      continue
    }

    const thread = ancestors[i]
    const child = path[i + 1]
    const anchor = child.anchor
    if (!anchor) continue

    const turns =
      i === 0 ? turnsPerLevel : Math.max(3, turnsPerLevel - Math.min(i, 3))
    const transcript = transcriptUpTo(thread.messages, anchor.messageId, turns)
    const originatingQuote = i === 0 ? null : (thread.anchor?.quote ?? null)
    sections.push(formatAncestorSection(i, transcript, originatingQuote))
  }

  const selected = leaf.anchor?.quote ?? ''
  sections.push(`${CONTEXT_QUOTE}\n«${clipText(selected, CONTEXT_QUOTE_CHARS)}»`)

  let out = sections.join('\n\n')
  if (out.length <= CONTEXT_BUDGET) return out

  // Over budget: rebuild with a tighter turn window, then hard-clip.
  const tight = threadContextTight(path, Math.max(2, turnsPerLevel - 3))
  out = tight.length <= CONTEXT_BUDGET ? tight : `${tight.slice(0, CONTEXT_BUDGET - 1)}…`
  return out
}

function threadContextTight(path: Thread[], turns: number): string {
  const leaf = path[path.length - 1]
  const ancestors = path.slice(0, -1)
  const omitCount = Math.max(0, ancestors.length - CONTEXT_MAX_ANCESTORS)
  const keepTail = CONTEXT_MAX_ANCESTORS - 1
  const keepFrom = omitCount > 0 ? ancestors.length - keepTail : 1
  const sections: string[] = []

  for (let i = 0; i < ancestors.length; i += 1) {
    if (omitCount > 0 && i >= 1 && i < keepFrom) {
      if (i === 1) sections.push(contextOmittedLabel(omitCount))
      continue
    }
    const thread = ancestors[i]
    const child = path[i + 1]
    const anchor = child.anchor
    if (!anchor) continue
    const transcript = transcriptUpTo(
      thread.messages,
      anchor.messageId,
      turns,
      Math.min(CONTEXT_CHARS_PER_TURN, 280),
    )
    const originatingQuote = i === 0 ? null : (thread.anchor?.quote ?? null)
    sections.push(formatAncestorSection(i, transcript, originatingQuote))
  }

  const selected = leaf.anchor?.quote ?? ''
  sections.push(`${CONTEXT_QUOTE}\n«${clipText(selected, CONTEXT_QUOTE_CHARS)}»`)
  return sections.join('\n\n')
}

/**
 * Quote + ancestor context for a non-root thread. Always both keys, so the
 * chat engine and the merge-summary path cannot send a quote without the chain
 * (or vice versa).
 */
export function branchForwardedProps(
  state: TreeState,
  threadId: string,
): { quote: string; context: string } | null {
  const thread = state.threads[threadId]
  if (!thread?.parentId || !thread.anchor) return null
  return {
    quote: thread.anchor.quote,
    context: threadContext(state, threadId),
  }
}
