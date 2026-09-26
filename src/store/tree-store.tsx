import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { createId } from '@/lib/ids'
import { activeSessionOf } from '@/lib/sessions'
import { lastSaveResult, loadLibrary, saveLibrary, subscribeSaveResult } from '@/lib/storage'
import { sessionReducer } from '@/store/session-reducer'
import type { Anchor, ChatMessage, ChatSession, SessionLibrary, Thread, ThreadSummary, TreeState } from '@/types'

type TreeContextValue = {
  state: TreeState
  sessions: ChatSession[]
  activeSessionId: string
  activeSession: ChatSession
  activeThread: Thread
  rootThread: Thread
  createThread: (parentId: string, anchor: Anchor, options?: { webSearch?: boolean }) => string
  setWebSearch: (threadId: string, on: boolean) => void
  expand: (parentId: string, childId: string | null) => void
  focus: (threadId: string) => void
  discard: (threadId: string) => void
  restoreThreads: (threads: Thread[], focusId?: string) => void
  /** `sessionId`: a chat other than the open one (a reply that finished in the background). */
  replaceMessages: (threadId: string, messages: ChatMessage[], sessionId?: string) => void
  appendMessage: (threadId: string, message: ChatMessage) => void
  undoTakeaway: (threadId: string, messageId: string) => void
  rewriteThread: (
    threadId: string,
    messages: ChatMessage[],
    dropAnchorMessageIds: string[],
  ) => void
  setSummary: (threadId: string, summary: ThreadSummary, basis: string, sessionId?: string) => void
  reset: () => void
  restoreDemo: () => void
  createSession: () => void
  switchSession: (sessionId: string) => void
  renameSession: (sessionId: string, title: string) => void
  deleteSession: (sessionId: string) => void
  restoreSession: (session: ChatSession) => void
  importSessions: (sessions: ChatSession[]) => void
  /** The last save was refused (storage full): recent changes live only in memory. */
  storageFull: boolean
  setSessionDocuments: (sessionId: string, documentIds: string[]) => void
  forgetDocument: (documentId: string) => void
}

const TreeContext = createContext<TreeContextValue | null>(null)

/** One load per page, shared by StrictMode's double mount; forgotten once done. */
let loading: Promise<SessionLibrary> | null = null

/** Chats load asynchronously (IndexedDB); nothing renders until they are here. */
export function TreeProvider({ children }: { children: ReactNode }) {
  const [initial, setInitial] = useState<SessionLibrary | null>(null)
  useEffect(() => {
    let live = true
    loading ??= loadLibrary().finally(() => { loading = null })
    void loading.then((library) => {
      if (live) setInitial(library)
    })
    return () => {
      live = false
    }
  }, [])
  if (!initial) return null
  return <LoadedTreeProvider initial={initial}>{children}</LoadedTreeProvider>
}

function LoadedTreeProvider({ initial, children }: { initial: SessionLibrary; children: ReactNode }) {
  const [library, dispatch] = useReducer(sessionReducer, initial)

  // A layout effect, so a change is queued for saving before the event that
  // made it returns: leaving the page right after still keeps it.
  useLayoutEffect(() => {
    void saveLibrary(library)
  }, [library])
  const storageFull = useSyncExternalStore(subscribeSaveResult, () => lastSaveResult() === 'full')

  const activeSession = activeSessionOf(library)
  const state = activeSession.treeState
  const rootThread = state.threads[state.rootId]
  const activeThread = state.threads[state.activeThreadId] ?? rootThread

  const createThread = useCallback((parentId: string, anchor: Anchor, options?: { webSearch?: boolean }) => {
    const thread: Thread = {
      id: createId('thread'),
      parentId,
      anchor,
      messages: [],
      createdAt: Date.now(),
      rev: 0,
      ...(options?.webSearch ? { webSearch: true } : {}),
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
      setWebSearch: (threadId, on) =>
        dispatch({ type: 'tree', action: { type: 'set-web-search', threadId, on } }),
      discard: (threadId) => dispatch({ type: 'tree', action: { type: 'discard', threadId } }),
      restoreThreads: (threads, focusId) => dispatch({ type: 'tree', action: { type: 'restore-threads', threads, focusId } }),
      replaceMessages: (threadId, messages, sessionId) =>
        dispatch({
          type: 'tree',
          action: { type: 'replace-messages', threadId, messages },
          sessionId,
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
      setSummary: (threadId, summary, basis, sessionId) =>
        dispatch({ type: 'tree', action: { type: 'set-summary', threadId, summary, basis }, sessionId }),
      reset: () => dispatch({ type: 'tree', action: { type: 'reset' } }),
      restoreDemo: () => dispatch({ type: 'tree', action: { type: 'restoreDemo' } }),
      createSession: () => dispatch({ type: 'create-session' }),
      switchSession: (sessionId) => dispatch({ type: 'switch-session', sessionId }),
      renameSession: (sessionId, title) =>
        dispatch({ type: 'rename-session', sessionId, title }),
      deleteSession: (sessionId) => dispatch({ type: 'delete-session', sessionId }),
      restoreSession: (session) => dispatch({ type: 'restore-session', session }),
      importSessions: (sessions) => dispatch({ type: 'import-sessions', sessions }),
      storageFull,
      setSessionDocuments: (sessionId, documentIds) =>
        dispatch({ type: 'set-session-documents', sessionId, documentIds }),
      forgetDocument: (documentId) => dispatch({ type: 'forget-document', documentId }),
    }),
    [library, state, activeSession, activeThread, rootThread, createThread, storageFull],
  )

  return <TreeContext.Provider value={value}>{children}</TreeContext.Provider>
}

export function useTree() {
  const value = useContext(TreeContext)
  if (!value) throw new Error('useTree must be used within TreeProvider')
  return value
}
