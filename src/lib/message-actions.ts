import { childThreads, descendantIds } from './tree.ts'
import type { ChatMessage, TreeState } from '@/types'

/** Keep messages through `messageId` inclusive. `null` if the id is missing. */
export function truncateAfterMessage(
  messages: ChatMessage[],
  messageId: string,
): ChatMessage[] | null {
  const index = messages.findIndex((message) => message.id === messageId)
  if (index < 0) return null
  return messages.slice(0, index + 1)
}

/**
 * Retry an assistant turn: keep the nearest preceding user message and
 * everything before it. Drops that assistant and every later message.
 */
export function retryFromAssistant(
  messages: ChatMessage[],
  assistantMessageId: string,
): ChatMessage[] | null {
  const index = messages.findIndex((message) => message.id === assistantMessageId)
  if (index < 0) return null
  if (messages[index]?.role !== 'assistant') return null
  for (let i = index - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') return messages.slice(0, i + 1)
  }
  return null
}

/** Regenerate from a user turn without rewriting its text or source anchors. */
export function retryFromUser(messages: ChatMessage[], messageId: string): ChatMessage[] | null {
  if (messages.find((message) => message.id === messageId)?.role !== 'user') return null
  return truncateAfterMessage(messages, messageId)
}

/**
 * Edit a user message and drop everything after it on this thread.
 * `null` if the id is missing or not a user turn.
 */
export function editUserMessage(
  messages: ChatMessage[],
  messageId: string,
  content: string,
): ChatMessage[] | null {
  const index = messages.findIndex((message) => message.id === messageId)
  if (index < 0) return null
  const message = messages[index]
  if (!message || message.role !== 'user') return null
  const next = messages.slice(0, index + 1)
  next[index] = { ...message, content }
  return next
}

export function droppedMessageIds(
  before: ChatMessage[],
  after: ChatMessage[],
): string[] {
  const keep = new Set(after.map((message) => message.id))
  return before.filter((message) => !keep.has(message.id)).map((message) => message.id)
}

/**
 * Direct children of `threadId` whose anchor sits on one of `messageIds`.
 * Edit/retry discards these (and their descendants) so stale offsets never
 * underline a rewritten passage.
 */
export function childIdsAnchoredToMessages(
  state: TreeState,
  threadId: string,
  messageIds: Iterable<string>,
): string[] {
  const ids = new Set(messageIds)
  return childThreads(state, threadId)
    .filter((child) => child.anchor && ids.has(child.anchor.messageId))
    .map((child) => child.id)
}

/** Those children plus every thread growing out of them. */
export function doomedIdsForAnchors(
  state: TreeState,
  threadId: string,
  messageIds: Iterable<string>,
): string[] {
  const doomed: string[] = []
  for (const childId of childIdsAnchoredToMessages(state, threadId, messageIds)) {
    doomed.push(...descendantIds(state, childId))
  }
  return doomed
}

export function dropAnchorIdsForEdit(
  before: ChatMessage[],
  after: ChatMessage[],
  editedMessageId: string,
): string[] {
  const ids = new Set(droppedMessageIds(before, after))
  ids.add(editedMessageId)
  return [...ids]
}
