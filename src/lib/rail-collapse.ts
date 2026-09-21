import { childThreads, pathTo } from '@/lib/tree'
import type { Thread, TreeState } from '@/types'

/** Per-session expand/collapse of the TREE rail (not the inline branch cards). */
export const RAIL_COLLAPSE_KEY_PREFIX = 'treechat:rail-collapse:'

export function railCollapseStorageKey(sessionId: string): string {
  return `${RAIL_COLLAPSE_KEY_PREFIX}${sessionId}`
}

/** Default: root expanded, every deeper node collapsed. */
export function defaultExpandedIds(rootId: string): string[] {
  return [rootId]
}

export function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const value of a) {
    if (!b.has(value)) return false
  }
  return true
}

export function toggleExpandedId(
  expandedIds: ReadonlySet<string>,
  threadId: string,
): Set<string> {
  const next = new Set(expandedIds)
  if (next.has(threadId)) next.delete(threadId)
  else next.add(threadId)
  return next
}

/**
 * Read a stored expanded-id list. Invalid or missing payloads fall back to
 * the default. An explicit empty list means the user collapsed the root.
 * Ids that no longer exist in the tree are dropped; if every stored id is
 * stale, we fall back to the default rather than a fully collapsed rail.
 */
export function parseExpandedIds(
  raw: unknown,
  knownIds: ReadonlySet<string>,
  rootId: string,
): Set<string> {
  const fallback = new Set(defaultExpandedIds(rootId))
  if (raw == null) return fallback

  let ids: unknown
  if (Array.isArray(raw)) {
    ids = raw
  } else if (raw && typeof raw === 'object' && 'expanded' in raw) {
    ids = (raw as { expanded: unknown }).expanded
  } else {
    return fallback
  }

  if (!Array.isArray(ids)) return fallback
  const strings = ids.filter((id): id is string => typeof id === 'string')
  if (ids.length > 0 && strings.length === 0) return fallback

  const next = new Set(strings.filter((id) => knownIds.has(id)))
  if (strings.length > 0 && next.size === 0) return fallback
  return next
}

export function loadExpandedIds(
  sessionId: string,
  knownIds: ReadonlySet<string>,
  rootId: string,
): Set<string> {
  const fallback = new Set(defaultExpandedIds(rootId))
  if (typeof localStorage === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(railCollapseStorageKey(sessionId))
    if (raw == null) return fallback
    return parseExpandedIds(JSON.parse(raw) as unknown, knownIds, rootId)
  } catch {
    return fallback
  }
}

export function saveExpandedIds(sessionId: string, expandedIds: ReadonlySet<string>) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(
      railCollapseStorageKey(sessionId),
      JSON.stringify({ expanded: [...expandedIds] }),
    )
  } catch {
    // quota / private mode — the in-memory set still works for this session
  }
}

/** Preorder walk that stops at collapsed nodes (their children stay hidden). */
export function visibleRailThreads(
  state: TreeState,
  expandedIds: ReadonlySet<string>,
): Thread[] {
  const root = state.threads[state.rootId]
  if (!root) return []
  const out: Thread[] = []
  const walk = (thread: Thread) => {
    out.push(thread)
    if (!expandedIds.has(thread.id)) return
    for (const child of childThreads(state, thread.id)) walk(child)
  }
  walk(root)
  return out
}

/**
 * Expand every ancestor of `threadId` so that node is visible in the rail.
 * Does not expand the node itself.
 */
export function revealThreadInRail(
  state: TreeState,
  expandedIds: ReadonlySet<string>,
  threadId: string,
): Set<string> {
  const path = pathTo(state, threadId)
  if (path.length === 0) return new Set(expandedIds)
  const next = new Set(expandedIds)
  for (let i = 0; i < path.length - 1; i += 1) {
    next.add(path[i].id)
  }
  return next
}
