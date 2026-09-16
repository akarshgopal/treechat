import { createSeedState } from '@/lib/seed'
import type { Branch, ChatMessage, TreeState, ViewMode } from '@/types'
import { STORAGE_KEY } from '@/types'

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

function parseBranch(value: unknown): Branch | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string') return null
  if (typeof record.sourceMessageId !== 'string') return null
  if (typeof record.start !== 'number' || typeof record.end !== 'number') return null
  if (typeof record.quote !== 'string') return null
  if (!Array.isArray(record.messages)) return null
  const messages = record.messages
    .map(parseMessage)
    .filter((message): message is ChatMessage => message !== null)
  return {
    id: record.id,
    sourceMessageId: record.sourceMessageId,
    start: record.start,
    end: record.end,
    quote: record.quote,
    messages,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
  }
}

function parseView(value: unknown): ViewMode {
  if (!value || typeof value !== 'object') return { kind: 'spine' }
  const record = value as Record<string, unknown>
  if (record.kind === 'conversation' && typeof record.branchId === 'string') {
    return { kind: 'conversation', branchId: record.branchId }
  }
  return { kind: 'spine' }
}

export function loadTreeState(): TreeState {
  if (typeof localStorage === 'undefined') return createSeedState()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createSeedState()
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return createSeedState()
    const record = parsed as Record<string, unknown>
    if (!Array.isArray(record.spine) || !Array.isArray(record.branches)) {
      return createSeedState()
    }
    const spine = record.spine
      .map(parseMessage)
      .filter((message): message is ChatMessage => message !== null)
    const branches = record.branches
      .map(parseBranch)
      .filter((branch): branch is Branch => branch !== null)
    if (spine.length === 0) return createSeedState()
    const view = parseView(record.view)
    const openBranchId =
      typeof record.openBranchId === 'string' ? record.openBranchId : null
    const openExists = openBranchId
      ? branches.some((branch) => branch.id === openBranchId)
      : false
    const viewExists =
      view.kind === 'spine' ||
      branches.some((branch) => branch.id === view.branchId)
    return {
      spine,
      branches,
      openBranchId: openExists ? openBranchId : null,
      view: viewExists ? view : { kind: 'spine' },
    }
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
