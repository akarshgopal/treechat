import type { ChatMessage, Thread, ThreadSummary } from '@/types'

/** The latest messages always go to the model verbatim. */
export const SUMMARY_KEEP_RECENT = 6
/** Unsummarized older history this large triggers a (re)summary. */
export const SUMMARY_TRIGGER_TOKENS = 8000
/** One summary pass reads at most this much, so the request itself fits. */
export const SUMMARY_MAX_INPUT_TOKENS = 24000

/** Rough, provider-agnostic: about four characters per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function estimateMessageTokens(messages: ChatMessage[]): number {
  // A few tokens of per-message overhead (role, separators).
  return messages.reduce((total, message) => total + estimateTokens(message.content) + 4, 0)
}

export type CompactionPlan = {
  previous?: string
  /** Messages to fold into the summary, oldest first. */
  messages: ChatMessage[]
  throughMessageId: string
}

/** Index of the last summarized message, or -1 if the summary no longer fits the thread. */
export function summaryIndex(messages: ChatMessage[], summary: ThreadSummary | undefined): number {
  if (!summary) return -1
  return messages.findIndex((message) => message.id === summary.throughMessageId)
}

/**
 * What to summarize next, or null when nothing needs it: everything but the
 * most recent messages that the current summary does not cover yet, once it
 * outgrows the trigger. One pass is capped; the caller re-plans for more.
 */
export function planCompaction(
  messages: ChatMessage[],
  summary: ThreadSummary | undefined,
  {
    keepRecent = SUMMARY_KEEP_RECENT,
    triggerTokens = SUMMARY_TRIGGER_TOKENS,
    maxInputTokens = SUMMARY_MAX_INPUT_TOKENS,
  } = {},
): CompactionPlan | null {
  const covered = summaryIndex(messages, summary)
  const start = covered + 1
  let end = messages.length - keepRecent
  // What is still sent in full should open on a user turn.
  while (end > start && messages[end]?.role !== 'user') end -= 1
  if (end <= start) return null

  const aged = messages.slice(start, end)
  if (estimateMessageTokens(aged) < triggerTokens) return null

  let take = 0
  let tokens = 0
  while (take < aged.length) {
    const next = estimateMessageTokens([aged[take]])
    if (take > 0 && tokens + next > maxInputTokens) break
    tokens += next
    take += 1
  }
  if (take < aged.length) {
    let boundary = take
    while (boundary > 1 && aged[boundary]?.role !== 'user') boundary -= 1
    if (aged[boundary]?.role === 'user') take = boundary
  }
  const chunk = aged.slice(0, take)
  return {
    ...(covered >= 0 && summary ? { previous: summary.content } : {}),
    messages: chunk,
    throughMessageId: chunk[chunk.length - 1].id,
  }
}

/**
 * A fingerprint of the messages a summary covers. A summary that finishes
 * after the thread was edited must not land on the new transcript.
 */
export function prefixFingerprint(messages: ChatMessage[], throughMessageId: string): string | null {
  const index = messages.findIndex((message) => message.id === throughMessageId)
  if (index < 0) return null
  let hash = 5381
  for (const message of messages.slice(0, index + 1)) {
    const text = `${message.id}\u0000${message.content}\u0001`
    for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0
  }
  return `${index}:${hash.toString(36)}`
}

/**
 * Whether a summary still describes a thread after its messages change: the
 * covered prefix must survive untouched. Edit and retry truncate the thread,
 * and an edit can rewrite the very message the summary ends on.
 */
export function summaryHolds(
  before: ChatMessage[],
  after: ChatMessage[],
  summary: ThreadSummary,
): boolean {
  const index = summaryIndex(before, summary)
  if (index < 0 || summaryIndex(after, summary) !== index) return false
  for (let i = 0; i <= index; i += 1) {
    if (before[i].id !== after[i].id || before[i].content !== after[i].content) return false
  }
  return true
}

/** The summary as the chat transport expects it in `forwardedProps.threadSummary`. */
export type ThreadSummaryProp = Pick<ThreadSummary, 'content' | 'throughMessageId'>

function isSummaryProp(value: unknown): value is ThreadSummaryProp {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.content === 'string' && Boolean(record.content.trim())
    && typeof record.throughMessageId === 'string'
}

/**
 * Swap summarized history for the summary text. Only messages after the
 * summary's last one are sent; the summary rides as `forwardedProps.summary`,
 * which `buildSystemPrompts` turns into a system section on every backend.
 * If the covered message is not in this request (a rewrite raced the
 * summary), the full transcript goes out and the summary is dropped.
 */
export function applySummaryToRequest(
  messages: unknown[],
  forwardedProps: Record<string, unknown>,
): { messages: unknown[]; forwardedProps: Record<string, unknown> } {
  const threadSummary = forwardedProps.threadSummary
  const rest = { ...forwardedProps }
  delete rest.threadSummary
  delete rest.summary
  if (!isSummaryProp(threadSummary)) return { messages, forwardedProps: rest }
  const index = messages.findIndex((message) =>
    Boolean(message) && typeof message === 'object'
    && (message as Record<string, unknown>).id === threadSummary.throughMessageId,
  )
  if (index < 0 || index >= messages.length - 1) return { messages, forwardedProps: rest }
  return {
    messages: messages.slice(index + 1),
    forwardedProps: { ...rest, summary: threadSummary.content },
  }
}

/** A thread as plain text for a one-shot request: its summary stands in for what it covers. */
export function compactTranscript(thread: Pick<Thread, 'messages' | 'summary'>): string {
  const through = summaryIndex(thread.messages, thread.summary)
  const lines = thread.messages
    .slice(through + 1)
    .map((message) => `${message.role}: ${message.content}`)
  if (through >= 0 && thread.summary) lines.unshift(`Earlier, summarized:\n${thread.summary.content}`)
  return lines.join('\n\n')
}
