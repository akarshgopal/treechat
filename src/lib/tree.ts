import type { Anchor, ChatMessage, Thread, TreeState } from '@/types'
import { summaryIndex } from './compaction.ts'

const CONTEXT_TURNS = 6
const CONTEXT_CHARS_PER_TURN = 480
const CONTEXT_QUOTE_CHARS = 240
const CONTEXT_MAX_ANCESTORS = 4
const CONTEXT_BUDGET = 4200
const CONTEXT_SUMMARY_CHARS = 1600
const CONTEXT_SUMMARY_LEVEL_CHARS = 5000
const CONTEXT_SUMMARY_BUDGET = 9000
/** Source text around a passage from a page or document; on top of the budget. */
const CONTEXT_SOURCE_CHARS = 1400

export const CONTEXT_MAIN = 'MAIN'
export const CONTEXT_QUOTE = 'SELECTED QUOTE'
/** Heads an ancestor level told through its running summary. */
export const CONTEXT_EARLIER = 'Earlier, summarized:'

/** A question gives a branch a recognizable name, even on the same quote. */
export function threadTitle(thread: Thread): string {
  if (!thread.parentId) return 'Main conversation'
  return clipText(
    thread.messages.find((message) => message.role === 'user' && message.content.trim())?.content
      ?? thread.anchor?.quote ?? 'New branch',
    64,
  )
}

export function contextBranchLabel(depth: number) {
  return `BRANCH depth ${depth}`
}

export function contextOmittedLabel(count: number) {
  return `[${count} ancestor level${count === 1 ? '' : 's'} omitted]`
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
 * Markdown as the words it shows, for one-line previews: links keep their
 * text, and emphasis, code ticks, headings, list and quote markers go.
 * ponytail: inline regexes, not a parser; fine for previews, never for rendering.
 */
export function markdownToPlain(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n?/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?![\w*])/g, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
}

/**
 * The run of messages up to (and including) `messageId`, as a transcript.
 * The anchor message is never truncated — it is the one holding the quote.
 */
function transcriptUpTo(
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

/** Clip without collapsing whitespace: summaries are often bullet lists. */
function clipBlock(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

type SummaryWindow = { summaryChars: number; levelChars: number }

/**
 * An ancestor level told through its running summary: the summary, then the
 * turns just before the anchor in full while they fit `levelChars`, then the
 * anchor itself. Null when the summary does not end at or before the anchor —
 * it would describe turns after the passage this branch grew from.
 */
function summarizedTranscriptUpTo(
  thread: Thread,
  messageId: string,
  turns: number,
  charsPerTurn: number,
  { summaryChars, levelChars }: SummaryWindow,
): string | null {
  const { messages, summary } = thread
  const anchorIndex = messages.findIndex((message) => message.id === messageId)
  const through = summaryIndex(messages, summary)
  if (!summary || anchorIndex < 0 || through < 0 || through > anchorIndex) return null

  const head = `${CONTEXT_EARLIER}\n${clipBlock(summary.content, summaryChars)}`
  if (through === anchorIndex) {
    const anchor = messages[anchorIndex]
    return `${head}\n\n${anchor.role}: ${anchor.content}`
  }
  const anchor = messages[anchorIndex]
  const anchorLine = `${anchor.role}: ${anchor.content}`
  let used = head.length + anchorLine.length
  const recent: string[] = []
  for (let i = anchorIndex - 1; i > through && recent.length < turns - 1; i -= 1) {
    const message = messages[i]
    const full = `${message.role}: ${message.content}`
    const line = used + full.length <= levelChars || message.content.length <= charsPerTurn
      ? full
      : `${message.role}: ${message.content.slice(0, charsPerTurn)}…`
    if (used + line.length > levelChars) break
    recent.unshift(line)
    used += line.length
  }
  const skipped = anchorIndex - 1 - through - recent.length
  return [
    head,
    ...(skipped > 0 ? [`[${skipped} message${skipped === 1 ? '' : 's'} omitted]`] : []),
    ...recent,
    anchorLine,
  ].join('\n\n')
}

/** Heads the quote; says where it came from when that was not the message. */
function quoteHeading(anchor: Anchor | null): string {
  if (anchor?.source) {
    const where = anchor.source.locator ? `, ${anchor.source.locator}` : ''
    return `${CONTEXT_QUOTE} (from ${anchor.source.kind === 'web' ? 'the page' : 'the document'} “${clipText(anchor.source.title, 120)}”${where})`
  }
  if (anchor?.region) return `${CONTEXT_QUOTE} (a region of the image ${clipText(anchor.region.name, 120)}, attached)`
  return CONTEXT_QUOTE
}

/** A passage from a page or document brings some of its surroundings. */
function sourceExcerpt(anchor: Anchor | null): string {
  const around = anchor?.source?.context?.trim()
  return around ? `\nAround it in the source:\n${clipText(around, CONTEXT_SOURCE_CHARS)}` : ''
}

function contextSections(
  path: Thread[],
  turnsAt: (level: number) => number,
  charsPerTurn: number,
  summaryWindow: SummaryWindow,
): { text: string; summarized: boolean } {
  const leaf = path[path.length - 1]
  const ancestors = path.slice(0, -1)
  const omitCount = Math.max(0, ancestors.length - CONTEXT_MAX_ANCESTORS)
  const keepTail = CONTEXT_MAX_ANCESTORS - 1
  const keepFrom = omitCount > 0 ? ancestors.length - keepTail : 1

  const sections: string[] = []
  let summarized = false
  for (let i = 0; i < ancestors.length; i += 1) {
    if (omitCount > 0 && i >= 1 && i < keepFrom) {
      if (i === 1) sections.push(contextOmittedLabel(omitCount))
      continue
    }

    const thread = ancestors[i]
    const child = path[i + 1]
    const anchor = child.anchor
    if (!anchor) continue

    const turns = turnsAt(i)
    // A document opened beside a thread is anchored to no message: the thread
    // as it was when the branch grew (or all of it, if that message is gone).
    const through = anchor.source?.throughMessageId
    const anchorId = anchor.messageId
      || (through && thread.messages.some((message) => message.id === through) ? through : thread.messages.at(-1)?.id)
      || ''
    const fromSummary = summarizedTranscriptUpTo(thread, anchorId, turns, charsPerTurn, summaryWindow)
    if (fromSummary) summarized = true
    const transcript = fromSummary
      ?? transcriptUpTo(thread.messages, anchorId, turns, charsPerTurn)
    const originatingQuote = i === 0 ? null : (thread.anchor?.quote ?? null)
    sections.push(formatAncestorSection(i, transcript, originatingQuote))
  }

  const selected = leaf.anchor?.quote ?? ''
  sections.push(`${quoteHeading(leaf.anchor)}\n«${clipText(selected, CONTEXT_QUOTE_CHARS)}»${sourceExcerpt(leaf.anchor)}`)
  return { text: sections.join('\n\n'), summarized }
}

/**
 * Everything upstream of a thread: a bounded ancestor chain from the root
 * down to the quote this thread is pinned to.
 *
 * Sections are labeled MAIN, BRANCH depth N, then SELECTED QUOTE so the
 * model can see structure instead of a mushy blob. Deep trees keep the root
 * and the nearest ancestors and drop the middle. An ancestor with a running
 * summary is told through it, which buys a larger budget: it replaces
 * fragments with the whole story up to the anchor.
 */
export function threadContext(
  state: TreeState,
  threadId: string,
  turnsPerLevel = CONTEXT_TURNS,
): string {
  const path = pathTo(state, threadId)
  if (path.length <= 1) return ''

  const full = contextSections(
    path,
    (i) => (i === 0 ? turnsPerLevel : Math.max(3, turnsPerLevel - Math.min(i, 3))),
    CONTEXT_CHARS_PER_TURN,
    { summaryChars: CONTEXT_SUMMARY_CHARS, levelChars: CONTEXT_SUMMARY_LEVEL_CHARS },
  )
  const budget = (full.summarized ? CONTEXT_SUMMARY_BUDGET : CONTEXT_BUDGET) + sourceExcerpt(path[path.length - 1]!.anchor).length
  if (full.text.length <= budget) return full.text

  // Over budget: rebuild with a tighter turn window, then hard-clip.
  const tightTurns = Math.max(2, turnsPerLevel - 3)
  const tight = contextSections(
    path,
    () => tightTurns,
    Math.min(CONTEXT_CHARS_PER_TURN, 280),
    { summaryChars: CONTEXT_SUMMARY_CHARS / 2, levelChars: CONTEXT_SUMMARY_LEVEL_CHARS / 3 },
  ).text
  return tight.length <= budget ? tight : `${tight.slice(0, budget - 1)}…`
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

/**
 * A branch's takeaway: the latest one brought back into its parent. Only the
 * summary itself, not the parent's other messages.
 */
export function branchTakeaway(state: TreeState, threadId: string): string | undefined {
  const thread = state.threads[threadId]
  const parent = thread?.parentId ? state.threads[thread.parentId] : undefined
  if (!parent) return undefined
  for (let index = parent.messages.length - 1; index >= 0; index -= 1) {
    const message = parent.messages[index]!
    if (message.kind === 'drop-summary' && message.sourceThreadId === threadId && message.content.trim()) return message.content.trim()
  }
  return undefined
}

/** The first question asked in a thread, if any. */
export function firstQuestion(thread: Thread): string | undefined {
  return thread.messages.find((message) => message.role === 'user' && message.content.trim())?.content.trim()
}
