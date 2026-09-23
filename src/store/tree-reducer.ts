import { prefixFingerprint, summaryHolds } from '../lib/compaction.ts'
import { doomedIdsForAnchors } from '../lib/message-actions.ts'
import { createEmptyState, createSeedState } from '../lib/seed.ts'
import { descendantIds, expansionToReveal } from '../lib/tree.ts'
import type { ChatMessage, Thread, ThreadSummary, TreeState } from '@/types'

export type Action =
  | { type: 'replace-messages'; threadId: string; messages: ChatMessage[] }
  | { type: 'append-message'; threadId: string; message: ChatMessage }
  | { type: 'undo-takeaway'; threadId: string; messageId: string }
  | {
      type: 'rewrite-thread'
      threadId: string
      messages: ChatMessage[]
      dropAnchorMessageIds: string[]
    }
  /** `basis` fingerprints the messages the summary was written from. */
  | { type: 'set-summary'; threadId: string; summary: ThreadSummary; basis: string }
  | { type: 'create-thread'; thread: Thread }
  | { type: 'expand'; parentId: string; childId: string | null }
  | { type: 'focus'; threadId: string }
  | { type: 'set-web-search'; threadId: string; on: boolean }
  | { type: 'discard'; threadId: string }
  | { type: 'reset' }
  | { type: 'restoreDemo' }

function withThread(state: TreeState, thread: Thread): TreeState {
  return { ...state, threads: { ...state.threads, [thread.id]: thread } }
}

/** New messages for a thread, dropping a summary they no longer agree with. */
function withMessages(thread: Thread, messages: ChatMessage[]): Thread {
  if (!thread.summary || summaryHolds(thread.messages, messages, thread.summary)) {
    return { ...thread, messages }
  }
  const next: Thread = { ...thread, messages }
  delete next.summary
  return next
}

/**
 * Drop a set of thread ids (and leave expansion / the frame consistent).
 * `fallbackActiveId` is used when the framed thread itself was removed.
 */
export function removeThreads(
  state: TreeState,
  doomed: Set<string>,
  fallbackActiveId: string,
): TreeState {
  if (doomed.size === 0) return state

  const threads: Record<string, Thread> = {}
  for (const [id, value] of Object.entries(state.threads)) {
    if (!doomed.has(id)) threads[id] = value
  }

  const expanded: Record<string, string | null> = {}
  for (const [parentId, childId] of Object.entries(state.expanded)) {
    if (doomed.has(parentId)) continue
    expanded[parentId] = childId && doomed.has(childId) ? null : childId
  }

  const activeThreadId = doomed.has(state.activeThreadId)
    ? (threads[fallbackActiveId] ? fallbackActiveId : state.rootId)
    : state.activeThreadId

  return { ...state, threads, expanded, activeThreadId }
}

export function reducer(state: TreeState, action: Action): TreeState {
  switch (action.type) {
    case 'undo-takeaway': {
      const thread = state.threads[action.threadId]
      if (!thread?.messages.some((message) => message.id === action.messageId && message.kind === 'drop-summary')) return state
      return withThread(state, {
        ...withMessages(thread, thread.messages.filter((message) => message.id !== action.messageId)),
        rev: thread.rev + 1,
      })
    }
    case 'replace-messages': {
      const thread = state.threads[action.threadId]
      if (!thread) return state
      return withThread(state, withMessages(thread, action.messages))
    }
    case 'append-message': {
      const thread = state.threads[action.threadId]
      if (!thread) return state
      // rev bump: this write came from outside the chat engine, so the engine
      // must remount and re-read rather than clobber it.
      return withThread(state, {
        ...thread,
        messages: [...thread.messages, action.message],
        rev: thread.rev + 1,
      })
    }
    case 'rewrite-thread': {
      const thread = state.threads[action.threadId]
      if (!thread) return state
      // No rev bump: the live engine already holds this transcript and will
      // reload from it. Remounting would drop that in-flight generate.
      const next = withThread(state, withMessages(thread, action.messages))
      const doomed = new Set(
        doomedIdsForAnchors(next, action.threadId, action.dropAnchorMessageIds),
      )
      return removeThreads(next, doomed, action.threadId)
    }
    case 'set-summary': {
      const thread = state.threads[action.threadId]
      if (!thread) return state
      // The thread moved on (edit, retry) while the summary was being written.
      if (prefixFingerprint(thread.messages, action.summary.throughMessageId) !== action.basis) return state
      return withThread(state, { ...thread, summary: action.summary })
    }
    case 'create-thread': {
      const parentId = action.thread.parentId
      if (!parentId) {
        return withThread(state, action.thread)
      }
      return {
        ...withThread(state, action.thread),
        expanded: {
          ...state.expanded,
          ...expansionToReveal(state, parentId),
          [parentId]: action.thread.id,
        },
      }
    }
    case 'expand':
      return {
        ...state,
        expanded: { ...state.expanded, [action.parentId]: action.childId },
      }
    case 'focus': {
      if (!state.threads[action.threadId]) return state
      return {
        ...state,
        activeThreadId: action.threadId,
        expanded: {
          ...state.expanded,
          ...expansionToReveal(state, action.threadId),
        },
      }
    }
    case 'set-web-search': {
      const thread = state.threads[action.threadId]
      if (!thread || Boolean(thread.webSearch) === action.on) return state
      // Absent rather than false, so threads without it stay as they were.
      const { webSearch: _off, ...rest } = thread
      return withThread(state, action.on ? { ...rest, webSearch: true } : rest)
    }
    case 'discard': {
      const thread = state.threads[action.threadId]
      if (!thread || thread.parentId === null) return state
      return removeThreads(
        state,
        new Set(descendantIds(state, action.threadId)),
        thread.parentId ?? state.rootId,
      )
    }
    case 'reset':
      return createEmptyState()
    case 'restoreDemo':
      return createSeedState()
    default:
      return state
  }
}
