import {
  capSessions,
  makeSession,
  normalizeSessionTitle,
  titleFromTree,
} from '../lib/sessions.ts'
import { reducer as treeReducer, type Action as TreeAction } from './tree-reducer.ts'
import type { ChatSession, SessionLibrary } from '@/types'

export type SessionAction =
  | { type: 'create-session' }
  | { type: 'switch-session'; sessionId: string }
  | { type: 'rename-session'; sessionId: string; title: string }
  | { type: 'delete-session'; sessionId: string }
  /** Undo a delete: put the chat back and open it. */
  | { type: 'restore-session'; session: ChatSession }
  /** Which stored documents a chat searches. */
  | { type: 'set-session-documents'; sessionId: string; documentIds: string[] }
  /** A document was removed from the library: detach it everywhere. */
  | { type: 'forget-document'; documentId: string }
  | { type: 'tree'; action: TreeAction }

function mapSession(
  library: SessionLibrary,
  sessionId: string,
  update: (session: ChatSession) => ChatSession,
): SessionLibrary {
  let changed = false
  const sessions = library.sessions.map((session) => {
    if (session.id !== sessionId) return session
    const next = update(session)
    if (next !== session) changed = true
    return next
  })
  return changed ? { ...library, sessions } : library
}

function isBlankSession(session: ChatSession) {
  const threads = Object.values(session.treeState.threads)
  return !session.titleLocked && threads.length === 1 && threads[0]!.messages.length === 0
}

function sameIds(a: string[] | undefined, b: string[]) {
  const current = a ?? []
  return current.length === b.length && current.every((id, index) => id === b[index])
}

/** An empty list is stored as no key, matching what the storage parser reads back. */
function withDocumentIds(session: ChatSession, documentIds: string[]): ChatSession {
  const next: ChatSession = { ...session, documentIds }
  if (documentIds.length === 0) delete next.documentIds
  return next
}

export function sessionReducer(
  state: SessionLibrary,
  action: SessionAction,
): SessionLibrary {
  switch (action.type) {
    case 'create-session': {
      const session = makeSession()
      const sessions = capSessions([session, ...state.sessions], session.id)
      return { sessions, activeSessionId: session.id }
    }
    case 'switch-session': {
      if (action.sessionId === state.activeSessionId) return state
      if (!state.sessions.some((session) => session.id === action.sessionId)) {
        return state
      }
      return { ...state, activeSessionId: action.sessionId }
    }
    case 'rename-session': {
      const title = normalizeSessionTitle(action.title)
      // Empty input normalizes to the default — still a rename, still locked.
      return mapSession(state, action.sessionId, (session) =>
        session.title === title && session.titleLocked
          ? session
          : { ...session, title, titleLocked: true, updatedAt: Date.now() },
      )
    }
    case 'delete-session': {
      const remaining = state.sessions.filter((session) => session.id !== action.sessionId)
      if (remaining.length === state.sessions.length) return state
      if (remaining.length === 0) {
        const session = makeSession()
        return { sessions: [session], activeSessionId: session.id }
      }
      const activeSessionId =
        action.sessionId === state.activeSessionId
          ? remaining.reduce((newest, session) =>
              session.updatedAt > newest.updatedAt ? session : newest,
            ).id
          : state.activeSessionId
      return { sessions: remaining, activeSessionId }
    }
    case 'restore-session': {
      if (state.sessions.some((session) => session.id === action.session.id)) return state
      // Deleting the last chat left a blank one in its place; drop that.
      const sessions = state.sessions.filter((session) => !isBlankSession(session))
      return { sessions: capSessions([action.session, ...sessions], action.session.id), activeSessionId: action.session.id }
    }
    case 'set-session-documents': {
      const ids = [...new Set(action.documentIds)]
      // Not activity: attaching must not reorder the chat list.
      return mapSession(state, action.sessionId, (session) =>
        sameIds(session.documentIds, ids) ? session : withDocumentIds(session, ids),
      )
    }
    case 'forget-document': {
      let changed = false
      const sessions = state.sessions.map((session) => {
        if (!session.documentIds?.includes(action.documentId)) return session
        changed = true
        return withDocumentIds(session, session.documentIds.filter((id) => id !== action.documentId))
      })
      return changed ? { ...state, sessions } : state
    }
    case 'tree': {
      const current = state.sessions.find(
        (session) => session.id === state.activeSessionId,
      )
      if (!current) return state
      const treeState = treeReducer(current.treeState, action.action)
      if (treeState === current.treeState) return state
      const title = current.titleLocked ? current.title : titleFromTree(treeState)
      return mapSession(state, current.id, (session) => ({
        ...session,
        treeState,
        title,
        updatedAt: Date.now(),
      }))
    }
    default:
      return state
  }
}
