import { createSeedState } from '../lib/seed.ts'
import { descendantIds } from '../lib/tree.ts'
import type { ChatMessage, Thread, TreeState } from '@/types'

export type Action =
  | { type: 'replace-messages'; threadId: string; messages: ChatMessage[] }
  | { type: 'append-message'; threadId: string; message: ChatMessage }
  | { type: 'create-thread'; thread: Thread }
  | { type: 'expand'; parentId: string; childId: string | null }
  | { type: 'focus'; threadId: string }
  | { type: 'discard'; threadId: string }
  | { type: 'reset' }

function withThread(state: TreeState, thread: Thread): TreeState {
  return { ...state, threads: { ...state.threads, [thread.id]: thread } }
}

export function reducer(state: TreeState, action: Action): TreeState {
  switch (action.type) {
    case 'replace-messages': {
      const thread = state.threads[action.threadId]
      if (!thread) return state
      return withThread(state, { ...thread, messages: action.messages })
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
    case 'create-thread': {
      const parentId = action.thread.parentId
      return {
        ...withThread(state, action.thread),
        expanded: parentId
          ? { ...state.expanded, [parentId]: action.thread.id }
          : state.expanded,
      }
    }
    case 'expand':
      return {
        ...state,
        expanded: { ...state.expanded, [action.parentId]: action.childId },
      }
    case 'focus':
      return state.threads[action.threadId]
        ? { ...state, activeThreadId: action.threadId }
        : state
    case 'discard': {
      const thread = state.threads[action.threadId]
      if (!thread || thread.parentId === null) return state

      const doomed = new Set(descendantIds(state, action.threadId))
      const threads: Record<string, Thread> = {}
      for (const [id, value] of Object.entries(state.threads)) {
        if (!doomed.has(id)) threads[id] = value
      }

      const expanded: Record<string, string | null> = {}
      for (const [parentId, childId] of Object.entries(state.expanded)) {
        if (doomed.has(parentId)) continue
        expanded[parentId] = childId && doomed.has(childId) ? null : childId
      }

      // If the frame was inside the discarded subtree, retreat to its parent.
      const activeThreadId = doomed.has(state.activeThreadId)
        ? (thread.parentId ?? state.rootId)
        : state.activeThreadId

      return { ...state, threads, expanded, activeThreadId }
    }
    case 'reset':
      return createSeedState()
    default:
      return state
  }
}
