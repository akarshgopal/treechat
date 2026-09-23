import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react'
import { createId } from '@/lib/ids'
import { activeSessionOf } from '@/lib/sessions'
import { loadLibrary, saveLibrary } from '@/lib/storage'
import { sessionReducer } from '@/store/session-reducer'
import type { Anchor, ChatMessage, ChatSession, Thread, TreeState } from '@/types'

type TreeContextValue = {
  state: TreeState
  sessions: ChatSession[]
  activeSessionId: string
  activeSession: ChatSession
  activeThread: Thread
  rootThread: Thread
  createThread: (parentId: string, anchor: Anchor) => string
  expand: (parentId: string, childId: string | null) => void
  focus: (threadId: string) => void
  discard: (threadId: string) => void
  replaceMessages: (threadId: string, messages: ChatMessage[]) => void
  appendMessage: (threadId: string, message: ChatMessage) => void
  undoTakeaway: (threadId: string, messageId: string) => void
  rewriteThread: (
    threadId: string,
    messages: ChatMessage[],
    dropAnchorMessageIds: string[],
  ) => void
  reset: () => void
  restoreDemo: () => void
  createSession: () => void
  switchSession: (sessionId: string) => void
  renameSession: (sessionId: string, title: string) => void
  deleteSession: (sessionId: string) => void
}

const TreeContext = createContext<TreeContextValue | null>(null)

export function TreeProvider({ children }: { children: ReactNode }) {
  const [library, dispatch] = useReducer(sessionReducer, null, loadLibrary)

  useEffect(() => {
    saveLibrary(library)
  }, [library])

  const activeSession = activeSessionOf(library)
  const state = activeSession.treeState
  const rootThread = state.threads[state.rootId]
  const activeThread = state.threads[state.activeThreadId] ?? rootThread

  const createThread = useCallback((parentId: string, anchor: Anchor) => {
    const thread: Thread = {
      id: createId('thread'),
      parentId,
      anchor,
      messages: [],
      createdAt: Date.now(),
      rev: 0,
    }
    dispatch({ type: 'tree', action: { type: 'create-thread', thread } })
    return thread.id
  }, [])

  const value = useMemo<TreeContextValue>(
    () => ({
      state,
      sessions: library.sessions,
      activeSessionId: library.activeSessionId,
      activeSession,
      activeThread,
      rootThread,
      createThread,
      expand: (parentId, childId) =>
        dispatch({ type: 'tree', action: { type: 'expand', parentId, childId } }),
      focus: (threadId) => dispatch({ type: 'tree', action: { type: 'focus', threadId } }),
      discard: (threadId) => dispatch({ type: 'tree', action: { type: 'discard', threadId } }),
      replaceMessages: (threadId, messages) =>
        dispatch({
          type: 'tree',
          action: { type: 'replace-messages', threadId, messages },
        }),
      appendMessage: (threadId, message) =>
        dispatch({
          type: 'tree',
          action: { type: 'append-message', threadId, message },
        }),
      undoTakeaway: (threadId, messageId) =>
        dispatch({ type: 'tree', action: { type: 'undo-takeaway', threadId, messageId } }),
      rewriteThread: (threadId, messages, dropAnchorMessageIds) =>
        dispatch({
          type: 'tree',
          action: {
            type: 'rewrite-thread',
            threadId,
            messages,
            dropAnchorMessageIds,
          },
        }),
      reset: () => dispatch({ type: 'tree', action: { type: 'reset' } }),
      restoreDemo: () => dispatch({ type: 'tree', action: { type: 'restoreDemo' } }),
      createSession: () => dispatch({ type: 'create-session' }),
      switchSession: (sessionId) => dispatch({ type: 'switch-session', sessionId }),
      renameSession: (sessionId, title) =>
        dispatch({ type: 'rename-session', sessionId, title }),
      deleteSession: (sessionId) => dispatch({ type: 'delete-session', sessionId }),
    }),
    [library, state, activeSession, activeThread, rootThread, createThread],
  )

  return <TreeContext.Provider value={value}>{children}</TreeContext.Provider>
}

export function useTree() {
  const value = useContext(TreeContext)
  if (!value) throw new Error('useTree must be used within TreeProvider')
  return value
}
