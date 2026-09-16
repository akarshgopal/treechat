export type Role = 'user' | 'assistant'

export type MessageKind = 'message' | 'drop-summary'

export type ChatMessage = {
  id: string
  role: Role
  content: string
  createdAt: number
  kind?: MessageKind
  /** For a merged summary: the quote of the thread it came from. */
  quote?: string
}

/** Where a thread is pinned inside its parent's message. */
export type Anchor = {
  messageId: string
  start: number
  end: number
  quote: string
}

/**
 * Every thread is a full conversation. The root is the one without a parent;
 * nothing else distinguishes it. A thread anchored to a passage inside another
 * thread's message is a branch, and its own messages can be branched again,
 * to any depth.
 */
export type Thread = {
  id: string
  parentId: string | null
  anchor: Anchor | null
  messages: ChatMessage[]
  createdAt: number
  /**
   * Bumped only when something outside the chat engine rewrites this thread's
   * messages (a merged summary landing). The engine remounts on a change so it
   * picks the new transcript up instead of overwriting it.
   */
  rev: number
}

export type TreeState = {
  threads: Record<string, Thread>
  rootId: string
  /** The thread holding the full frame. */
  activeThreadId: string
  /** Per parent thread, the one child expanded inline beneath it. */
  expanded: Record<string, string | null>
}

export type ProviderStatus = {
  mode: 'mock' | 'live'
  provider: 'xai' | 'openai' | 'openrouter' | 'mock'
  model: string
}

export const STORAGE_KEY = 'treechat:v2'
export const LEGACY_STORAGE_KEY = 'treechat:v1'
