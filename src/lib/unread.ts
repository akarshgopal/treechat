import type { ChatSession, Thread, TreeState } from '@/types'

/** Threads of this chat with a reply not yet seen. */
export function unreadCount(tree: TreeState): number {
  return Object.values(tree.threads).filter((thread) => thread.unread).length
}

export function hasUnread(session: ChatSession): boolean {
  return unreadCount(session.treeState) > 0
}

/** A copy of `thread` without the unread flag, or the same one when it had none. */
export function markRead(thread: Thread): Thread {
  if (!thread.unread) return thread
  const { unread: _seen, ...rest } = thread
  return rest
}

/** Clear the flag on these threads; the same tree when none had it. */
export function readThreads(tree: TreeState, threadIds: Iterable<string>): TreeState {
  let threads: Record<string, Thread> | null = null
  for (const id of threadIds) {
    const thread = tree.threads[id]
    if (!thread?.unread) continue
    threads ??= { ...tree.threads }
    threads[id] = markRead(thread)
  }
  return threads ? { ...tree, threads } : tree
}

/*
 * The lanes on screen right now, per chat: full lanes only (not folded
 * strips, not ancestors hidden on a phone), and nothing while the tab is
 * hidden. A reply finishing anywhere else is new.
 */
const onScreen = new Map<string, ReadonlySet<string>>()

export function setVisibleThreads(sessionId: string, threadIds: readonly string[]) {
  if (threadIds.length === 0) onScreen.delete(sessionId)
  else onScreen.set(sessionId, new Set(threadIds))
}

export function isThreadVisible(sessionId: string, threadId: string): boolean {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false
  return onScreen.get(sessionId)?.has(threadId) ?? false
}
