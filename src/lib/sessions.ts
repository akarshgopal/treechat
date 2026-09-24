import { createId } from '@/lib/ids'
import { createEmptyState } from '@/lib/seed'
import { truncate } from '@/lib/utils'
import type { ChatSession, SessionLibrary, TreeState } from '@/types'

export const DEFAULT_SESSION_TITLE = 'New chat'
export const SESSION_TITLE_MAX = 42

/** Collapse whitespace and clip to the title budget. */
export function normalizeSessionTitle(value: string): string {
  const compact = value.trim().replace(/\s+/g, ' ')
  if (!compact) return DEFAULT_SESSION_TITLE
  return truncate(compact, SESSION_TITLE_MAX)
}

/** Default title from the root thread's first non-empty user message. */
export function titleFromTree(state: TreeState): string {
  const root = state.threads[state.rootId]
  if (!root) return DEFAULT_SESSION_TITLE
  const first = root.messages.find(
    (message) => message.role === 'user' && message.content.trim(),
  )
  if (!first) return DEFAULT_SESSION_TITLE
  return normalizeSessionTitle(first.content)
}

export function makeSession(
  treeState: TreeState = createEmptyState(),
  now = Date.now(),
): ChatSession {
  return {
    id: createId('session'),
    title: titleFromTree(treeState),
    createdAt: treeState.threads[treeState.rootId]?.createdAt ?? now,
    updatedAt: now,
    treeState,
    titleLocked: false,
  }
}

export function createEmptyLibrary(now = Date.now()): SessionLibrary {
  const session = makeSession(createEmptyState(), now)
  return { sessions: [session], activeSessionId: session.id }
}

export function libraryFromTree(treeState: TreeState, now = Date.now()): SessionLibrary {
  const session = makeSession(treeState, now)
  return { sessions: [session], activeSessionId: session.id }
}

export function activeSessionOf(library: SessionLibrary): ChatSession {
  return (
    library.sessions.find((session) => session.id === library.activeSessionId) ??
    library.sessions[0] ??
    makeSession()
  )
}

/** Newest activity first — the switcher order. */
export function sortSessions(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)
}

export function replaceActiveTree(
  library: SessionLibrary,
  treeState: TreeState,
  now = Date.now(),
): SessionLibrary {
  const current = activeSessionOf(library)
  const title = current.titleLocked ? current.title : titleFromTree(treeState)
  return {
    ...library,
    sessions: library.sessions.map((session) =>
      session.id === current.id
        ? { ...session, treeState, title, updatedAt: now }
        : session,
    ),
  }
}
