import { createEmptyState } from '@/lib/seed'
import {
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
  ThreadSummary,
  TreeState,
} from '@/types'
import { LEGACY_STORAGE_KEY, STORAGE_KEY, V2_STORAGE_KEY } from '@/types'
import { parseCitations } from './citations.ts'
import { parseAttachments } from './attachments/parse.ts'

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
  const attachments = parseAttachments(record.attachments)
  return {
    id: record.id,
    role: record.role,
    content: record.content,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
    kind: record.kind === 'drop-summary' ? 'drop-summary' : 'message',
    quote: typeof record.quote === 'string' ? record.quote : undefined,
    sourceThreadId: typeof record.sourceThreadId === 'string' ? record.sourceThreadId : undefined,
    ...(citations ? { citations } : {}),
    ...(attachments ? { attachments } : {}),
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

function parseSummary(value: unknown): ThreadSummary | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.content !== 'string' || !record.content.trim()) return null
  if (typeof record.throughMessageId !== 'string') return null
  return {
    content: record.content,
    throughMessageId: record.throughMessageId,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
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
  const messages = parseMessages(record.messages)
  const summary = parseSummary(record.summary)
  return {
    id: record.id,
    parentId,
    anchor: parentId === null ? null : anchor,
    messages,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
    rev: typeof record.rev === 'number' ? record.rev : 0,
    // A summary of messages that are no longer there would describe nothing.
    ...(summary && messages.some((message) => message.id === summary.throughMessageId) ? { summary } : {}),
    ...(record.webSearch === true ? { webSearch: true } : {}),
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

/** A stored or exported chat, validated; null when unusable. */
export function parseSession(value: unknown): ChatSession | null {
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
  const documentIds = Array.isArray(record.documentIds)
    ? [...new Set(record.documentIds.filter((id): id is string => typeof id === 'string' && id.length > 0))]
    : []
  return {
    id: record.id,
    title,
    createdAt,
    updatedAt,
    treeState,
    titleLocked,
    ...(documentIds.length > 0 ? { documentIds } : {}),
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

/*
 * The library lives in IndexedDB (`treechat-library`), so it is not capped at
 * localStorage's ~5 MB. localStorage still matters: chats from before the move
 * are migrated from there, and it is the fallback when IndexedDB is missing or
 * failing, so a save is never simply dropped.
 */
const DB_NAME = 'treechat-library'
const DB_VERSION = 1
const LIBRARY = 'library'
const RECORD = 'current'
/** An open that never settles (seen in some Safari versions) must not hang the app. */
const OPEN_TIMEOUT_MS = 4_000

/** What is written, to either store. `savedAt` tells which copy is newer. */
type StoredLibrary = SessionLibrary & { savedAt: number }

let opening: Promise<IDBDatabase> | null = null

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'))
  })
}

function open(): Promise<IDBDatabase> {
  if (opening) return opening
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser has no IndexedDB.'))
      return
    }
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      reject(new Error('Chat storage did not open.'))
    }, OPEN_TIMEOUT_MS)
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(LIBRARY)) req.result.createObjectStore(LIBRARY)
    }
    req.onsuccess = () => {
      clearTimeout(timer)
      const db = req.result
      if (timedOut) {
        db.close()
        return
      }
      db.onversionchange = () => {
        db.close()
        opening = null
      }
      resolve(db)
    }
    req.onerror = () => {
      clearTimeout(timer)
      reject(req.error)
    }
    req.onblocked = () => {
      clearTimeout(timer)
      reject(new Error('Chat storage is blocked by another tab.'))
    }
  })
  opening.catch(() => { opening = null })
  return opening
}

async function readStored(): Promise<unknown> {
  const db = await open()
  return request(db.transaction(LIBRARY).objectStore(LIBRARY).get(RECORD))
}

async function writeStored(value: StoredLibrary): Promise<void> {
  const db = await open()
  const tx = db.transaction(LIBRARY, 'readwrite')
  tx.objectStore(LIBRARY).put(value, RECORD)
  await done(tx)
}

function isQuotaError(error: unknown) {
  return error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22)
}

function savedAtOf(value: unknown): number {
  const savedAt = (value as { savedAt?: unknown } | null)?.savedAt
  return typeof savedAt === 'number' ? savedAt : 0
}

/** localStorage still holds a v3 library (from before the move, or a fallback save). */
let localCopy = false

/**
 * The library as localStorage holds it. A v2 single-tree blob (or v1 spine)
 * becomes one session; a v3 library wins over both.
 */
function readLocalLibrary(): { library: SessionLibrary; savedAt: number } | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    localCopy = raw !== null
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown
        const library = parseLibrary(parsed)
        if (library) return { library, savedAt: savedAtOf(parsed) }
        const tree = parseTreeState(parsed)
        if (tree) return { library: libraryFromTree(tree), savedAt: 0 }
      } catch {
        // unreadable v3 — fall through to v2 / v1
      }
    }
    const older = readTreeFromKey(V2_STORAGE_KEY) ?? readTreeFromKey(LEGACY_STORAGE_KEY)
    return older ? { library: libraryFromTree(older), savedAt: 0 } : null
  } catch {
    return null
  }
}

/**
 * Load the session library: from IndexedDB, unless localStorage holds a newer
 * copy (chats from before the move, or saved while IndexedDB was failing).
 * A copy taken from localStorage, or a migrated v2/v1 tree, is saved at once.
 */
export async function loadLibrary(): Promise<SessionLibrary> {
  let stored: unknown
  try {
    stored = await readStored()
  } catch {
    // No IndexedDB: localStorage is all there is.
  }
  const fromDb = stored ? parseLibrary(stored) : null
  const local = readLocalLibrary()
  if (local && (!fromDb || local.savedAt > savedAtOf(stored))) {
    await saveLibrary(local.library)
    return local.library
  }
  return fromDb ?? createEmptyLibrary()
}

/** `full`: the browser refused the write (quota); nothing was dropped. */
export type SaveResult = 'saved' | 'full' | 'unavailable'

let lastSave: SaveResult = 'saved'
const saveListeners = new Set<() => void>()

/** For `useSyncExternalStore`: whether the most recent save went through. */
export function subscribeSaveResult(listener: () => void) {
  saveListeners.add(listener)
  return () => saveListeners.delete(listener)
}
export const lastSaveResult = () => lastSave

function reportSave(result: SaveResult): SaveResult {
  if (result !== lastSave) {
    lastSave = result
    for (const listener of saveListeners) listener()
  }
  return result
}

/**
 * Write the whole library. Never deletes chats to make room: when storage is
 * full the write fails, the caller warns, and the person decides what to do.
 */
async function write(library: SessionLibrary): Promise<SaveResult> {
  const sessions = library.sessions.length > 0 ? library.sessions : createEmptyLibrary().sessions
  const activeSessionId = sessions.some((session) => session.id === library.activeSessionId)
    ? library.activeSessionId
    : sessions[0]!.id
  const value: StoredLibrary = { sessions, activeSessionId, savedAt: Date.now() }
  try {
    await writeStored(value)
    if (localCopy) {
      try {
        localStorage.removeItem(STORAGE_KEY)
        localCopy = false
      } catch {
        // Harmless: the IndexedDB copy is newer, so it wins on load.
      }
    }
    return 'saved'
  } catch (error) {
    if (isQuotaError(error)) return 'full'
  }
  // No usable IndexedDB: save to localStorage, as before the move.
  if (typeof localStorage === 'undefined') return 'unavailable'
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    localCopy = true
    return 'saved'
  } catch {
    return 'full'
  }
}

let pending: SessionLibrary | null = null
let writing: Promise<void> | null = null

async function flush() {
  while (pending) {
    const next = pending
    pending = null
    reportSave(await write(next))
  }
  writing = null
}

/**
 * Save the library. Writes run one at a time; a save requested while one is
 * in flight replaces any other still waiting, so only the latest is written.
 */
export function saveLibrary(library: SessionLibrary): Promise<SaveResult> {
  pending = library
  writing ??= flush()
  return writing.then(lastSaveResult)
}

/** Tests: finish writing, then forget the open connection and the last result. */
export async function closeLibraryStore() {
  await writing
  const db = await opening?.catch(() => null)
  db?.close()
  opening = null
  localCopy = false
  reportSave('saved')
}

/** Active session's tree — used by tests and anything that still thinks in trees. */
export async function loadTreeState(): Promise<TreeState> {
  const library = await loadLibrary()
  const active =
    library.sessions.find((session) => session.id === library.activeSessionId) ??
    library.sessions[0]
  return active?.treeState ?? createEmptyState()
}

export async function saveTreeState(state: TreeState) {
  const library = await loadLibrary()
  await saveLibrary(replaceActiveTree(library, state))
}
