export type Role = 'user' | 'assistant'

export type MessageKind = 'message' | 'drop-summary'

/**
 * A source backing part of a message. Web search and local documents share
 * this shape so they render, persist, and open as source lanes the same way.
 * Message text refers to a citation by its marker, e.g. `[1]`.
 */
export type Citation = {
  /** The marker used in the message text: `"1"` for `[1]`. Unique per message. */
  id: string
  kind: 'web' | 'document'
  title: string
  /** Web sources. */
  url?: string
  /** Local documents: the stored document this came from. */
  documentId?: string
  /** Where inside the source, e.g. "p. 4" or a heading. */
  locator?: string
  /** The cited text, when the provider returns it. */
  snippet?: string
}

export type ChatMessage = {
  id: string
  role: Role
  content: string
  createdAt: number
  kind?: MessageKind
  /** For a merged summary: the quote of the thread it came from. */
  quote?: string
  /** Link a takeaway to the exploration that produced it. */
  sourceThreadId?: string
  /** Sources behind this message, in marker order. */
  citations?: Citation[]
}

/**
 * A running summary of a thread's older messages, so long threads fit the
 * model's context. Requests send it plus only the messages after
 * `throughMessageId`; the transcript itself is never trimmed.
 */
export type ThreadSummary = {
  content: string
  /** The last message the summary covers. */
  throughMessageId: string
  createdAt: number
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
  summary?: ThreadSummary
}

export type TreeState = {
  threads: Record<string, Thread>
  rootId: string
  /** The thread holding the full frame. */
  activeThreadId: string
  /** Per parent thread, the one child expanded inline beneath it. */
  expanded: Record<string, string | null>
}

/** One named chat, with its own tree. */
export type ChatSession = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  treeState: TreeState
  /** When true, the first user message no longer overwrites the title. */
  titleLocked: boolean
}

export type SessionLibrary = {
  sessions: ChatSession[]
  activeSessionId: string
}

export type ProviderStatus = {
  mode: 'mock' | 'live'
  provider: 'xai' | 'openai' | 'openrouter' | 'mock'
  model: string
}

/** Session library. A v2 single-tree blob is migrated into one session on load. */
export const STORAGE_KEY = 'treechat:v3'
export const V2_STORAGE_KEY = 'treechat:v2'
export const LEGACY_STORAGE_KEY = 'treechat:v1'
