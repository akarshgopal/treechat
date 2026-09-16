import { createSeedState } from '@/lib/seed'
import type { Anchor, ChatMessage, Thread, TreeState } from '@/types'
import { LEGACY_STORAGE_KEY, STORAGE_KEY } from '@/types'

function isRole(value: unknown): value is ChatMessage['role'] {
  return value === 'user' || value === 'assistant'
}

function parseMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string') return null
  if (!isRole(record.role)) return null
  if (typeof record.content !== 'string') return null
  return {
    id: record.id,
    role: record.role,
    content: record.content,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
    kind: record.kind === 'drop-summary' ? 'drop-summary' : 'message',
    quote: typeof record.quote === 'string' ? record.quote : undefined,
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
  if (!root || root.messages.length === 0) return null

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

export function loadTreeState(): TreeState {
  if (typeof localStorage === 'undefined') return createSeedState()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object') {
        const state = parseV2(parsed as Record<string, unknown>)
        if (state) return state
      }
      return createSeedState()
    }

    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacy) {
      const parsed = JSON.parse(legacy) as unknown
      if (parsed && typeof parsed === 'object') {
        const state = migrateV1(parsed as Record<string, unknown>)
        if (state) return state
      }
    }
    return createSeedState()
  } catch {
    return createSeedState()
  }
}

export function saveTreeState(state: TreeState) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // quota / private mode
  }
}
