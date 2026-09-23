import { createEmptyState } from '@/lib/seed'
import {
  capSessions,
  createEmptyLibrary,
  libraryFromTree,
  replaceActiveTree,
  titleFromTree,
} from '@/lib/sessions'
import type {
  Anchor,
  ChatMessage,
  ChatSession,
  SessionLibrary,
  Thread,
  TreeState,
} from '@/types'
import { LEGACY_STORAGE_KEY, STORAGE_KEY, V2_STORAGE_KEY } from '@/types'
import { parseCitations } from './citations.ts'

function isRole(value: unknown): value is ChatMessage['role'] {
  return value === 'user' || value === 'assistant'
}

function parseMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string') return null
  if (!isRole(record.role)) return null
  if (typeof record.content !== 'string') return null
  const citations = parseCitations(record.citations)
  return {
    id: record.id,
    role: record.role,
    content: record.content,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
    kind: record.kind === 'drop-summary' ? 'drop-summary' : 'message',
    quote: typeof record.quote === 'string' ? record.quote : undefined,
    sourceThreadId: typeof record.sourceThreadId === 'string' ? record.sourceThreadId : undefined,
    ...(citations ? { citations } : {}),
  }
}

function parseMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return []
  return value
    .map(parseMessage)
    .filter((message): message is ChatMessage => message !== null)
}

function parseAnchor(value: unknown): Anchor | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.messageId !== 'string') return null
  if (typeof record.start !== 'number' || typeof record.end !== 'number') return null
  if (typeof record.quote !== 'string') return null
  return {
    messageId: record.messageId,
    start: record.start,
    end: record.end,
    quote: record.quote,
  }
}

function parseThread(value: unknown): Thread | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string') return null
  const parentId = typeof record.parentId === 'string' ? record.parentId : null
  const anchor = parseAnchor(record.anchor)
  // A non-root thread without a usable anchor has nowhere to attach.
  if (parentId !== null && !anchor) return null
  return {
    id: record.id,
    parentId,
    anchor: parentId === null ? null : anchor,
    messages: parseMessages(record.messages),
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
    rev: typeof record.rev === 'number' ? record.rev : 0,
  }
}

/** v1 stored a flat spine plus branches hanging off it. Lift it into the tree. */
function migrateV1(record: Record<string, unknown>): TreeState | null {
  if (!Array.isArray(record.spine) || !Array.isArray(record.branches)) return null
  const messages = parseMessages(record.spine)
  if (messages.length === 0) return null

  const root: Thread = {
    id: 'thread-root',
    parentId: null,
    anchor: null,
    messages,
    createdAt: messages[0]?.createdAt ?? Date.now(),
    rev: 0,
  }
  const threads: Record<string, Thread> = { [root.id]: root }

  for (const value of record.branches) {
    if (!value || typeof value !== 'object') continue
    const branch = value as Record<string, unknown>
    if (typeof branch.id !== 'string') continue
    if (typeof branch.sourceMessageId !== 'string') continue
    if (typeof branch.start !== 'number' || typeof branch.end !== 'number') continue
    if (typeof branch.quote !== 'string') continue
    threads[branch.id] = {
      id: branch.id,
      parentId: root.id,
      anchor: {
        messageId: branch.sourceMessageId,
        start: branch.start,
        end: branch.end,
        quote: branch.quote,
      },
      messages: parseMessages(branch.messages),
      createdAt: typeof branch.createdAt === 'number' ? branch.createdAt : Date.now(),
      rev: 0,
    }
  }

  return { threads, rootId: root.id, activeThreadId: root.id, expanded: {} }
}

/** Drop threads whose parent went missing, so the tree can't be orphaned. */
function pruneOrphans(threads: Record<string, Thread>, rootId: string) {
  const kept: Record<string, Thread> = {}
  for (const thread of Object.values(threads)) {
    let current: Thread | undefined = thread
    const seen = new Set<string>()
    while (current && current.id !== rootId && !seen.has(current.id)) {
      seen.add(current.id)
      current = current.parentId ? threads[current.parentId] : undefined
    }
    if (current?.id === rootId || thread.id === rootId) kept[thread.id] = thread
  }
  return kept
}

function parseV2(record: Record<string, unknown>): TreeState | null {
  if (!record.threads || typeof record.threads !== 'object') return null
  if (typeof record.rootId !== 'string') return null

  const parsed: Record<string, Thread> = {}
  for (const value of Object.values(record.threads as Record<string, unknown>)) {
    const thread = parseThread(value)
    if (thread) parsed[thread.id] = thread
  }
  const root = parsed[record.rootId]
  // Empty root is a valid fresh chat — rejecting it would re-seed on reload.
  if (!root) return null

  const threads = pruneOrphans(parsed, root.id)

  const activeThreadId =
    typeof record.activeThreadId === 'string' && threads[record.activeThreadId]
      ? record.activeThreadId
      : root.id

  const expanded: Record<string, string | null> = {}
  if (record.expanded && typeof record.expanded === 'object') {
    for (const [parentId, childId] of Object.entries(
      record.expanded as Record<string, unknown>,
    )) {
      if (!threads[parentId]) continue
      if (typeof childId !== 'string' || !threads[childId]) continue
      if (threads[childId].parentId !== parentId) continue
      expanded[parentId] = childId
    }
  }

  return { threads, rootId: root.id, activeThreadId, expanded }
}

/** Parse a v2-shaped tree blob (also the `treeState` of a v3 session). */
export function parseTreeState(value: unknown): TreeState | null {
  if (!value || typeof value !== 'object') return null
  return parseV2(value as Record<string, unknown>)
}

function parseSession(value: unknown): ChatSession | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || !record.id) return null
  const treeState = parseTreeState(record.treeState)
  if (!treeState) return null
  const createdAt = typeof record.createdAt === 'number' ? record.createdAt : Date.now()
  const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : createdAt
  const titleLocked = record.titleLocked === true
  const title =
    typeof record.title === 'string' && record.title.trim()
      ? record.title.trim()
      : titleFromTree(treeState)
  return {
    id: record.id,
    title,
    createdAt,
    updatedAt,
    treeState,
    titleLocked,
  }
}

function parseLibrary(value: unknown): SessionLibrary | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.sessions)) return null
  const sessions: ChatSession[] = []
  for (const entry of record.sessions) {
    const session = parseSession(entry)
    if (session) sessions.push(session)
  }
  if (sessions.length === 0) return null
  const activeSessionId =
    typeof record.activeSessionId === 'string' &&
    sessions.some((session) => session.id === record.activeSessionId)
      ? record.activeSessionId
      : sessions[0].id
  return { sessions, activeSessionId }
}

function readTreeFromKey(key: string): TreeState | null {
  const raw = localStorage.getItem(key)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as Record<string, unknown>
    if (key === LEGACY_STORAGE_KEY) return migrateV1(record)
    return parseV2(record)
  } catch {
    return null
  }
}

/**
 * Load the session library. A v2 single-tree blob (or v1 spine) becomes one
 * session on first load; that migrated library is written to v3 immediately.
 */
export function loadLibrary(): SessionLibrary {
  if (typeof localStorage === 'undefined') return createEmptyLibrary()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown
        const library = parseLibrary(parsed)
        if (library) return library
        const tree = parseTreeState(parsed)
        if (tree) {
          const migrated = libraryFromTree(tree)
          saveLibrary(migrated)
          return migrated
        }
      } catch {
        // unreadable v3 — fall through to v2 / v1
      }
    }

    const v2 = readTreeFromKey(V2_STORAGE_KEY)
    if (v2) {
      const migrated = libraryFromTree(v2)
      saveLibrary(migrated)
      return migrated
    }

    const v1 = readTreeFromKey(LEGACY_STORAGE_KEY)
    if (v1) {
      const migrated = libraryFromTree(v1)
      saveLibrary(migrated)
      return migrated
    }

    return createEmptyLibrary()
  } catch {
    return createEmptyLibrary()
  }
}

export function saveLibrary(library: SessionLibrary) {
  if (typeof localStorage === 'undefined') return
  const activeId = library.activeSessionId
  let sessions = capSessions(library.sessions, activeId)
  if (sessions.length === 0) {
    const empty = createEmptyLibrary()
    sessions = empty.sessions
  }
  const activeStill =
    sessions.some((session) => session.id === activeId) ? activeId : sessions[0]!.id
  const payload: SessionLibrary = { sessions, activeSessionId: activeStill }

  while (payload.sessions.length > 0) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
      return
    } catch {
      if (payload.sessions.length <= 1) return
      const drop = payload.sessions
        .filter((session) => session.id !== payload.activeSessionId)
        .sort((a, b) => a.updatedAt - b.updatedAt)[0]
      if (!drop) return
      payload.sessions = payload.sessions.filter((session) => session.id !== drop.id)
    }
  }
}

/** Active session's tree — used by tests and anything that still thinks in trees. */
export function loadTreeState(): TreeState {
  const library = loadLibrary()
  const active =
    library.sessions.find((session) => session.id === library.activeSessionId) ??
    library.sessions[0]
  return active?.treeState ?? createEmptyState()
}

export function saveTreeState(state: TreeState) {
  const library = loadLibrary()
  saveLibrary(replaceActiveTree(library, state))
}
