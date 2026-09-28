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

/**
 * A file sent with a message. Only this small record lives in the chat; the
 * image or text itself is kept in IndexedDB (src/lib/attachments/store.ts)
 * so screenshots never crowd localStorage.
 */
export type Attachment = {
  id: string
  kind: 'image' | 'text'
  name: string
  /** Stored type: prepared images are re-encoded (webp or jpeg). */
  mime: string
  /** Bytes as stored, after resizing. */
  size: number
  width?: number
  height?: number
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
  /** Images and files the user sent with this message. */
  attachments?: Attachment[]
  /** What a reply cost, as OpenRouter reported it. */
  usage?: MessageUsage
  /** The model asked for when it was not the one in Settings ("Try another model"). */
  model?: string
  /**
   * A reply's other answers (regenerated, or from another model), oldest
   * first. `content` and the fields above are always the current answer, the
   * only one context, takeaways and summaries see.
   */
  alternates?: AnswerAlternate[]
  /** Where the current answer sits among all of them; its index when absent is last. */
  answerIndex?: number
}

/** An answer kept beside the current one on the same reply. */
export type AnswerAlternate = {
  content: string
  createdAt: number
  citations?: Citation[]
  usage?: MessageUsage
  model?: string
}

/** Tokens and cost of one reply; `cost` is USD (OpenRouter credits). */
export type MessageUsage = {
  promptTokens: number
  completionTokens: number
  cost?: number
  /** The model that answered, which can differ from the one asked for. */
  model?: string
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

/**
 * Where a thread is pinned inside its parent's message. `start` / `end` count
 * characters of the message's text; they are 0 when the anchor is in a source
 * or an image (see `source` / `region`), so older versions underline nothing.
 */
export type Anchor = {
  messageId: string
  start: number
  end: number
  quote: string
  /** Branched from a cited page or a document rather than the message itself. */
  source?: AnchorSource
  /** Branched from a region of an image attached to the message. */
  region?: AnchorRegion
}

/** The page or document a passage was selected in. */
export type AnchorSource = {
  kind: 'web' | 'document'
  title: string
  /** The passage in the source's text, in characters. */
  start: number
  end: number
  url?: string
  documentId?: string
  /** Where in the source, e.g. "p. 4". */
  locator?: string
  /** The citation of the anchor message it was opened from, if any. */
  citationId?: string
  /** A bounded stretch of the source around the passage, sent as context. */
  context?: string
  /**
   * A document opened beside a thread hangs off no message (`messageId: ''`);
   * its context is the thread up to this message, its last when branched.
   */
  throughMessageId?: string
}

/** A rectangle of an image, in fractions of its width and height. */
export type AnchorRegion = {
  attachmentId: string
  name: string
  x: number
  y: number
  w: number
  h: number
  /** The cropped region, stored as its own image and sent with the branch. */
  crop?: Attachment
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
  /** Replies in this thread search the web and cite their sources. Set only when on. */
  webSearch?: boolean
  /** A reply finished here while it was out of sight. Set only when true. */
  unread?: true
  /**
   * While a regenerate runs: the answers of the reply it replaced, saved so
   * that a failure, or a reload, puts them back rather than losing them.
   */
  pendingAnswers?: PendingAnswers
}

/** A replaced reply's answers, in order, and which one was showing. */
export type PendingAnswers = { answers: AnswerAlternate[]; index: number }

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
  /** Stored documents this chat searches before each request. */
  documentIds?: string[]
}

export type SessionLibrary = {
  sessions: ChatSession[]
  activeSessionId: string
}

export type ProviderStatus = {
  mode: 'mock' | 'live'
  provider: 'openrouter' | 'mock'
  model: string
}

/** Session library. A v2 single-tree blob is migrated into one session on load. */
export const STORAGE_KEY = 'treechat:v3'
export const V2_STORAGE_KEY = 'treechat:v2'
export const LEGACY_STORAGE_KEY = 'treechat:v1'
