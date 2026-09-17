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
import { loadTreeState, saveTreeState } from '@/lib/storage'
import { reducer } from '@/store/tree-reducer'
import type { Anchor, ChatMessage, Thread, TreeState } from '@/types'

type TreeContextValue = {
  state: TreeState
  activeThread: Thread
  rootThread: Thread
  createThread: (parentId: string, anchor: Anchor) => string
  expand: (parentId: string, childId: string | null) => void
  focus: (threadId: string) => void
  discard: (threadId: string) => void
  replaceMessages: (threadId: string, messages: ChatMessage[]) => void
  appendMessage: (threadId: string, message: ChatMessage) => void
  resetDemo: () => void
}

const TreeContext = createContext<TreeContextValue | null>(null)

export function TreeProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, null, loadTreeState)

  useEffect(() => {
    saveTreeState(state)
  }, [state])

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
    dispatch({ type: 'create-thread', thread })
    return thread.id
  }, [])

  const value = useMemo<TreeContextValue>(
    () => ({
      state,
      activeThread,
      rootThread,
      createThread,
      expand: (parentId, childId) =>
        dispatch({ type: 'expand', parentId, childId }),
      focus: (threadId) => dispatch({ type: 'focus', threadId }),
      discard: (threadId) => dispatch({ type: 'discard', threadId }),
      replaceMessages: (threadId, messages) =>
        dispatch({ type: 'replace-messages', threadId, messages }),
      appendMessage: (threadId, message) =>
        dispatch({ type: 'append-message', threadId, message }),
      resetDemo: () => dispatch({ type: 'reset' }),
    }),
    [state, activeThread, rootThread, createThread],
  )

  return <TreeContext.Provider value={value}>{children}</TreeContext.Provider>
}

export function useTree() {
  const value = useContext(TreeContext)
  if (!value) throw new Error('useTree must be used within TreeProvider')
  return value
}
