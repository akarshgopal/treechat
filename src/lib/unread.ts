import type { ChatSession, Thread, TreeState } from '@/types'
import { pathTo } from './tree.ts'

/** Threads of this chat with a reply not yet seen. */
export function unreadCount(tree: TreeState): number {
  return Object.values(tree.threads).filter((thread) => thread.unread).length
}

export function hasUnread(session: ChatSession): boolean {
  return unreadCount(session.treeState) > 0
}

/** The threads on screen when `activeThreadId` is framed: it and its ancestors. */
export function visibleThreadIds(tree: TreeState): Set<string> {
  return new Set(pathTo(tree, tree.activeThreadId).map((thread) => thread.id))
}

/** A copy of `thread` without the unread flag, or the same one when it had none. */
export function markRead(thread: Thread): Thread {
  if (!thread.unread) return thread
  const { unread: _seen, ...rest } = thread
  return rest
}

/** Clear the flag on every thread now on screen. */
export function clearVisibleUnread(tree: TreeState): TreeState {
  let threads: Record<string, Thread> | null = null
  for (const id of visibleThreadIds(tree)) {
    const thread = tree.threads[id]
    if (!thread?.unread) continue
    threads ??= { ...tree.threads }
    threads[id] = markRead(thread)
  }
  return threads ? { ...tree, threads } : tree
}
