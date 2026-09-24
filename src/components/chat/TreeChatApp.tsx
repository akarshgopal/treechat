import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type TouchEvent,
} from 'react'
import { useChat } from '@tanstack/ai-react'
import { ChevronDown, Settings, SquarePen } from 'lucide-react'
import { BranchPopover } from '@/components/chat/BranchPopover'
import { CommandPalette } from '@/components/chat/CommandPalette'
import { DocumentDropZone, DocumentsDialog, DocumentsLibraryEntry, DocumentsSidebarSection } from '@/components/chat/Documents'
import { BranchHeader, MainHeader } from '@/components/chat/LaneHeader'
import { Toast, type ToastState } from '@/components/chat/Toast'
import { Lanes, type LaneFrame, type TrailingLane } from '@/components/chat/Lanes'
import { SourceLane } from '@/components/chat/SourceLane'
import { TakeawayDialog } from '@/components/chat/TakeawayDialog'
import { SessionList } from '@/components/chat/SessionList'
import { SettingsDialog } from '@/components/chat/SettingsDialog'
import { Sidebar } from '@/components/chat/Sidebar'
import { ThreadView } from '@/components/chat/ThreadView'
import { TreeRail } from '@/components/chat/TreeRail'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MAX_ATTACHMENTS, prepareFiles } from '@/lib/attachments/prepare'
import { pruneAttachments } from '@/lib/attachments/store'
import { chatConnection } from '@/lib/chat-connection'
import { addDocumentFiles } from '@/lib/documents/library'
import { loadModelCapabilities, modelReadsImages } from '@/lib/model-capabilities'
import { takeRunCitations } from '@/lib/citations'
import { createId } from '@/lib/ids'
import {
  doomedIdsForAnchors,
  dropAnchorIdsForEdit,
  droppedMessageIds,
  editUserMessage,
  retryFromAssistant,
  retryFromUser,
} from '@/lib/message-actions'
import { fromUIMessages, sameTranscript, toUIMessages } from '@/lib/messages'
import {
  DEFAULT_OPENROUTER_MODEL,
  OPENROUTER_MODEL_OPTIONS,
  loadProviderConfig,
  patchProviderConfig,
  providerRequestHeaders,
  shortModelName,
  type ClientProviderConfig,
} from '@/lib/provider'
import { lensQuestion, type Lens } from '@/lib/lenses'
import { exportChats, parseImport, storeImportedAttachments } from '@/lib/transfer'
import {
  offsetsInRoot,
  selectableMessageFromRange,
  selectionClientRect,
  plainTextSkippingIgnore,
  snapRangeToWords,
} from '@/lib/selection'
import { branchForwardedProps, descendantIds, pathTo } from '@/lib/tree'
import { refreshSummary } from '@/lib/summarize'
import { isBranchShortcut } from '@/lib/utils'
import { useTree } from '@/store/tree-store'
import type { Attachment, ChatMessage, ChatSession, Citation, ProviderStatus } from '@/types'

/** Unreferenced attachments younger than this survive a clean-up. */
const ATTACHMENT_GRACE_MS = 24 * 60 * 60 * 1000

const idleStatus: ProviderStatus = {
  mode: 'mock',
  provider: 'mock',
  model: DEFAULT_OPENROUTER_MODEL,
}

type ChipState = {
  threadId: string
  messageId: string
  start: number
  end: number
  quote: string
  top: number
  left: number
  bottom: number
  /** The passage in the DOM, snapped to whole words. */
  range: Range | null
}

/**
 * Handlers shared by every thread in the tree. Threads render recursively, so
 * drilling these as props would mean re-threading a dozen of them at each level.
 */
type EngineHandle = {
  stop: () => void
  isLoading: boolean
}

/** A source open beside the reply that cites it. Shell state, never persisted. */
type OpenSource = { threadId: string; messageId: string; citationId: string }

const SOURCE_LANE_ID = 'source-lane'
/** Set once the web search cost has been mentioned in this browser. */
const WEB_SEARCH_COST_KEY = 'treechat:web-search-cost-seen'

type ShellValue = {
  draftFor: (threadId: string) => string
  setDraft: (threadId: string, value: string) => void
  /** Files waiting in a thread's composer, sent with its next message. */
  attachmentsFor: (threadId: string) => Attachment[]
  setAttachments: (threadId: string, update: (current: Attachment[]) => Attachment[]) => void
  status: ProviderStatus
  onSwitchModel: (model: string) => void
  registerComposer: (threadId: string, el: HTMLTextAreaElement | null) => void
  registerEngine: (threadId: string, handle: EngineHandle | null) => void
  onSelectMessage: (threadId: string, messageId: string) => void
  onOpenChild: (parentId: string, childId: string | null) => void
  onFocus: (threadId: string) => void
  onMerge: (threadId: string) => void
  onDiscard: (threadId: string) => void
  takeInitialQuestion: (threadId: string) => string | undefined
  onAskMessage: (threadId: string, messageId: string) => void
  onReturn: (threadId: string, takeawayId?: string) => void
  scrollPositions: Map<string, number>
  sessionId: string
  onShowDemo: () => void
  openSource: OpenSource | null
  onOpenSource: (threadId: string, messageId: string, citationId: string) => void
  /** Phones: one lane at a time, and the app bar names the chat. */
  narrow: boolean
  onRenameChat: (title: string) => void
  onDeleteChat: () => void
  /** Web search was just switched on somewhere: mention its cost once. */
  onWebSearchOn: () => void
}

const ShellContext = createContext<ShellValue | null>(null)

/** Stable empties, so memoized consumers don't see a new array every render. */
const NO_ATTACHMENTS: Attachment[] = []
const NO_THREAD_ATTACHMENTS: Record<string, Attachment[]> = {}

/**
 * Warn before an image goes to a model that can't read it, with a one-click
 * switch. Only with a key (OpenRouter's list says which models read images);
 * unknown models get no warning.
 */
function useVisionNotice(files: Attachment[], status: ProviderStatus, onSwitch: (model: string) => void): ReactNode {
  const hasImage = files.some((file) => file.kind === 'image')
  const live = status.mode === 'live' && status.provider === 'openrouter'
  const [, setLoaded] = useState(0)
  useEffect(() => {
    if (!hasImage || !live) return
    let cancelled = false
    void loadModelCapabilities().then(() => {
      if (!cancelled) setLoaded((count) => count + 1)
    })
    return () => {
      cancelled = true
    }
  }, [hasImage, live])
  if (!hasImage || !live || modelReadsImages(status.model) !== false) return null
  const alternative = OPENROUTER_MODEL_OPTIONS.find((option) => modelReadsImages(option.id) === true)
  return (
    <span className="text-amber-300/90" data-testid="vision-warning">
      {shortModelName(status.model)} can’t read images.{' '}
      {alternative ? (
        <button type="button" className="font-medium text-branch-bright underline underline-offset-2" onClick={() => onSwitch(alternative.id)}>
          Switch to {alternative.label}
        </button>
      ) : 'Pick a model that reads images in Settings.'}
    </span>
  )
}

function useShell() {
  const value = useContext(ShellContext)
  if (!value) throw new Error('ShellContext missing')
  return value
}

type PendingRewrite = {
  lostMessages: number
  lostBranches: number
  verb: string
  apply: () => void
  resolve: (confirmed: boolean) => void
}

/**
 * One chat engine per rendered thread. Keyed on `rev` by the caller, so an
 * external write (a merged summary) remounts it and it re-reads the transcript
 * rather than overwriting it with its own stale copy.
 */
function ThreadEngine({ threadId, openChildId, frame }: { threadId: string; openChildId: string | null; frame: LaneFrame }) {
  const { state, replaceMessages, rewriteThread, setSummary, setWebSearch, activeSession, setSessionDocuments } = useTree()
  const shell = useShell()
  const thread = state.threads[threadId]

  const [initialMessages] = useState(() => toUIMessages(thread?.messages ?? []))
  const forwarded = branchForwardedProps(state, threadId)
  const summary = thread?.summary
  const anchorAttachments = thread?.anchor && thread.parentId
    ? state.threads[thread.parentId]?.messages.find((message) => message.id === thread.anchor!.messageId)?.attachments
    : undefined
  const chat = useChat({
    threadId,
    connection: chatConnection,
    initialMessages,
    forwardedProps: {
      ...forwarded,
      cacheSessionId: shell.sessionId,
      // The transport retrieves excerpts from these documents before sending.
      documentIds: activeSession.documentIds ?? [],
      ...(thread?.webSearch ? { webSearch: true } : {}),
      ...(summary ? { threadSummary: { content: summary.content, throughMessageId: summary.throughMessageId } } : {}),
      // A branch from a message with images shows the model those images too.
      ...(anchorAttachments ? { anchorAttachments } : {}),
    },
  })

  const { sendMessage } = chat
  const { takeInitialQuestion } = shell
  useEffect(() => {
    // StrictMode detaches and reattaches useChat during its mount replay.
    // Sending in that first effect starts a request that detach immediately
    // aborts. Consume the pending question only after the mount has settled.
    const timer = window.setTimeout(() => {
      const question = takeInitialQuestion(threadId)
      if (question) void sendMessage(question)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [sendMessage, takeInitialQuestion, threadId])

  const initial = useMemo(() => thread?.messages ?? [], [thread])
  useEffect(() => {
    const next = fromUIMessages(chat.messages)
    if (next.length === 0 && initial.length > 0) return
    if (!sameTranscript(next, initial)) replaceMessages(threadId, next)
  }, [chat.messages, initial, replaceMessages, threadId])

  // When a reply finishes, attach any sources its transport recorded.
  const wasLoading = useRef(false)
  const { setMessages } = chat
  useEffect(() => {
    const finished = wasLoading.current && !chat.isLoading
    wasLoading.current = chat.isLoading
    if (!finished) return
    // Off the reply's path: the next request picks the summary up when it lands.
    if (!chat.error) void refreshSummary(threadId, fromUIMessages(chat.messages), summary, (next, basis) => setSummary(threadId, next, basis))
    const citations = takeRunCitations(threadId)
    const last = chat.messages.at(-1)
    if (!citations || last?.role !== 'assistant') return
    setMessages(chat.messages.map((message) =>
      message === last ? { ...message, metadata: { ...(message.metadata ?? {}), citations } } : message,
    ))
  }, [chat.error, chat.isLoading, chat.messages, setMessages, setSummary, summary, threadId])

  useEffect(() => {
    shell.registerEngine(threadId, {
      stop: () => chat.stop(),
      isLoading: chat.isLoading,
    })
    return () => shell.registerEngine(threadId, null)
  }, [chat, shell, threadId])

  const [pendingRewrite, setPendingRewrite] = useState<PendingRewrite | null>(null)
  const [attachBusy, setAttachBusy] = useState(false)
  const [attachProblem, setAttachProblem] = useState<string | null>(null)
  const pendingFiles = shell.attachmentsFor(threadId)
  const visionNotice = useVisionNotice(pendingFiles, shell.status, shell.onSwitchModel)

  if (!thread) return null

  const snapshot = () => {
    const live = fromUIMessages(chat.messages)
    return live.length > 0 ? live : thread.messages
  }

  const send = () => {
    const text = shell.draftFor(threadId).trim()
    const attachments = shell.attachmentsFor(threadId)
    if (!text && attachments.length === 0) return
    shell.setDraft(threadId, '')
    shell.setAttachments(threadId, () => [])
    setAttachProblem(null)
    // The object form carries attachments as metadata (the bytes stay in
    // IndexedDB) and, unlike a bare string, allows a message with no text.
    void chat.sendMessage(attachments.length > 0 ? { content: text, metadata: { attachments } } : text)
  }

  const addFiles = async (files: File[]) => {
    const current = shell.attachmentsFor(threadId)
    setAttachBusy(true)
    try {
      const prepared = await prepareFiles(files, MAX_ATTACHMENTS - current.length)
      if (prepared.attachments.length > 0) {
        shell.setAttachments(threadId, (existing) => [...existing, ...prepared.attachments])
      }
      const problems = [...prepared.errors]
      if (prepared.documents.length > 0) {
        // PDFs are too big to resend with every turn; they join this chat's Documents.
        const ids = addDocumentFiles(prepared.documents)
        if (ids.length > 0) setSessionDocuments(activeSession.id, [...(activeSession.documentIds ?? []), ...ids])
        problems.push(`${prepared.documents.map((file) => file.name).join(', ')} added to this chat’s Documents — searched, not sent whole.`)
      }
      setAttachProblem(problems.length > 0 ? problems.join(' ') : null)
    } finally {
      setAttachBusy(false)
    }
  }

  /**
   * Apply a rewrite now if it only replaces the reply being regenerated.
   * Anything more (later turns, branches anchored below) asks first.
   * Resolves false when the person keeps the conversation as it is.
   */
  const rewrite = (
    next: ChatMessage[] | null,
    before: ChatMessage[],
    anchorIds: string[],
    replacedId: string | undefined,
    verb: string,
  ): Promise<boolean> => {
    if (!next) return Promise.resolve(false)
    const dropped = droppedMessageIds(before, next)
    const lostMessages = dropped.filter((id) => id !== replacedId).length
    const lostBranches = doomedIdsForAnchors(state, threadId, anchorIds).length
    const apply = () => {
      if (chat.isLoading) chat.stop()
      chat.setMessages(toUIMessages(next))
      rewriteThread(threadId, next, anchorIds)
      void chat.reload()
    }
    if (lostMessages === 0 && lostBranches === 0) {
      apply()
      return Promise.resolve(true)
    }
    return new Promise((resolve) => {
      setPendingRewrite({ lostMessages, lostBranches, verb, apply, resolve })
    })
  }

  /** The reply that directly answers a user turn, if any — it is being replaced anyway. */
  const replyAfter = (messages: ChatMessage[], messageId: string) => {
    const index = messages.findIndex((message) => message.id === messageId)
    const reply = messages[index + 1]
    return reply?.role === 'assistant' && reply.kind !== 'drop-summary' ? reply.id : undefined
  }

  const retryAssistant = (messageId: string) => {
    const before = snapshot()
    const next = retryFromAssistant(before, messageId)
    void rewrite(next, before, next ? droppedMessageIds(before, next) : [], messageId, 'Regenerate')
  }

  const editUser = (messageId: string, content: string) => {
    const before = snapshot()
    const next = editUserMessage(before, messageId, content)
    return rewrite(next, before, next ? dropAnchorIdsForEdit(before, next, messageId) : [], replyAfter(before, messageId), 'Edit & resend')
  }

  const regenerateUser = (messageId: string) => {
    const before = snapshot()
    const next = retryFromUser(before, messageId)
    void rewrite(next, before, next ? droppedMessageIds(before, next) : [], replyAfter(before, messageId), 'Regenerate')
  }

  const closeRewrite = (confirmed: boolean) => {
    if (!pendingRewrite) return
    if (confirmed) pendingRewrite.apply()
    pendingRewrite.resolve(confirmed)
    setPendingRewrite(null)
  }

  return (
    <>
    <ThreadView
      thread={thread}
      state={state}
      openChildId={openChildId}
      scrollPositions={shell.scrollPositions}
      scrollKey={`${shell.sessionId}:${threadId}`}
      error={chat.error?.message}
      onRetryError={() => { void chat.reload() }}
      onShowDemo={shell.onShowDemo}
      blankNote={shell.narrow && shell.status.mode === 'mock' ? 'Replies are demo text until you add an OpenRouter key in Settings.' : undefined}
      onAskMessage={shell.onAskMessage}
      leadOffset={frame.leadOffset}
      openCitation={shell.openSource?.threadId === threadId ? shell.openSource : null}
      onOpenCitation={shell.onOpenSource}
      header={thread.parentId ? (
        <BranchHeader
          thread={thread}
          onMerge={() => shell.onMerge(threadId)}
          onDiscard={() => shell.onDiscard(threadId)}
          onReturn={() => shell.onReturn(threadId)}
          onCollapse={frame.onCollapse}
          summarized={Object.values(state.threads).some((entry) => entry.messages.some((message) => message.sourceThreadId === threadId))}
        />
      ) : shell.narrow ? undefined : (
        <MainHeader
          title={activeSession.title}
          onRename={shell.onRenameChat}
          onDelete={shell.onDeleteChat}
          onCollapse={frame.onCollapse}
        />
      )}
      draft={shell.draftFor(threadId)}
      onDraftChange={(value) => shell.setDraft(threadId, value)}
      composerAttach={{
        items: pendingFiles,
        busy: attachBusy,
        onAdd: (files) => void addFiles(files),
        onRemove: (id) => shell.setAttachments(threadId, (current) => current.filter((item) => item.id !== id)),
      }}
      composerNotice={attachProblem || visionNotice ? (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {attachProblem ? <span data-testid="attach-problem">{attachProblem}</span> : null}
          {visionNotice}
        </span>
      ) : undefined}
      composerWebSearch={{
        on: Boolean(thread.webSearch),
        paid: shell.status.mode === 'live',
        onToggle: () => {
          if (!thread.webSearch) shell.onWebSearchOn()
          setWebSearch(threadId, !thread.webSearch)
        },
      }}
      onSend={send}
      onStop={() => chat.stop()}
      isLoading={chat.isLoading}
      onSelectMessage={shell.onSelectMessage}
      onOpenChild={shell.onOpenChild}
      onFocusChild={shell.onFocus}
      onRetryAssistant={retryAssistant}
      onRegenerateUser={regenerateUser}
      onEditUser={editUser}
      composerRef={(el) => shell.registerComposer(threadId, el)}
      accentComposer={Boolean(thread.anchor)}
      placeholder={
        thread.anchor
          ? 'Ask in this branch…'
          : thread.messages.length === 0
            ? 'Ask anything…'
            : 'Reply…'
      }
      emptyLabel={
        thread.anchor
          ? 'Ask a follow-up…'
          : undefined
      }
    />
    {/* Mounted only while pending: reopening a closing Radix dialog can
        strand its overlay on top of the new one. */}
    {pendingRewrite ? (
    <AlertDialog open onOpenChange={(open) => { if (!open) closeRewrite(false) }}>
      <AlertDialogContent data-testid="rewrite-confirm">
        <AlertDialogHeader>
          <AlertDialogTitle>Rewrite the conversation from here?</AlertDialogTitle>
          <AlertDialogDescription>
            {rewriteLoss(pendingRewrite.lostMessages, pendingRewrite.lostBranches)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep conversation</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="rewrite-confirm-action"
            onClick={() => closeRewrite(true)}
          >
            {pendingRewrite.verb}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    ) : null}
    </>
  )
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}

function rewriteLoss(messages: number, branches: number) {
  const parts = [
    messages > 0 ? plural(messages, 'later message', 'later messages') : '',
    branches > 0 ? plural(branches, 'branch', 'branches') : '',
  ].filter(Boolean)
  return `This removes ${parts.join(' and ')} in this conversation. This cannot be undone.`
}

function TreeChatShell({
  epoch,
  status,
  onNewChat,
  onRestoreDemo,
  onProviderConfigChange,
  drafts,
  onDraftChange,
  attachments,
  onAttachmentsChange,
  onSwitchModel,
  scrollPositions,
  toast,
  onToast,
}: {
  epoch: number
  status: ProviderStatus
  onNewChat: () => void
  onRestoreDemo: () => void
  onProviderConfigChange: (config: ClientProviderConfig | null) => void
  drafts: Record<string, string>
  onDraftChange: (threadId: string, value: string) => void
  attachments: Record<string, Attachment[]>
  onAttachmentsChange: (threadId: string, update: (current: Attachment[]) => Attachment[]) => void
  onSwitchModel: (model: string) => void
  scrollPositions: Map<string, number>
  /** Lives above the shell, which remounts when the chat changes. */
  toast: ToastState | null
  onToast: (toast: ToastState | null) => void
}) {
  const {
    state,
    sessions,
    activeSessionId,
    activeSession,
    activeThread,
    createThread,
    expand,
    focus,
    discard,
    restoreThreads,
    appendMessage,
    undoTakeaway,
    switchSession,
    renameSession,
    deleteSession,
    restoreSession,
    setWebSearch,
    importSessions,
    storageFull,
  } = useTree()
  const [source, setSource] = useState<OpenSource | null>(null)

  const [chip, setChip] = useState<ChipState | null>(null)
  /** A question being written about a passage, in the popover beside it. */
  const [asking, setAsking] = useState<{ passage: ChipState; initial: string; returnFocus?: HTMLElement | null } | null>(null)
  const [previewThreadId, setPreviewThreadId] = useState<string | null>(null)
  const [returnTarget, setReturnTarget] = useState<{ threadId: string; messageId: string; branchId: string; takeawayId?: string } | null>(null)
  const dismissToast = useCallback(() => onToast(null), [onToast])
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [documentsOpen, setDocumentsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  /** Threads with a reply streaming in, for the sidebar and connectors. */
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set())
  const composersRef = useRef<Record<string, HTMLTextAreaElement | null>>({})
  const enginesRef = useRef<Record<string, EngineHandle>>({})
  const lastRangeRef = useRef<ChipState | null>(null)
  const focusNextRef = useRef<string | null>(null)
  const holdChipRef = useRef(false)
  const initialQuestionsRef = useRef<Record<string, string>>({})

  const draftFor = useCallback((threadId: string) => drafts[threadId] ?? '', [drafts])
  const attachmentsFor = useCallback((threadId: string) => attachments[threadId] ?? NO_ATTACHMENTS, [attachments])
  const setDraft = onDraftChange
  const takeInitialQuestion = useCallback((threadId: string) => {
    const question = initialQuestionsRef.current[threadId]
    delete initialQuestionsRef.current[threadId]
    return question
  }, [])

  const registerComposer = useCallback(
    (threadId: string, el: HTMLTextAreaElement | null) => {
      composersRef.current[threadId] = el
      if (!el || focusNextRef.current !== threadId) return
      const tryFocus = (attempt: number) => {
        const current = composersRef.current[threadId]
        if (current) {
          current.focus()
          if (document.activeElement === current) {
            focusNextRef.current = null
            return
          }
        }
        if (attempt < 10) requestAnimationFrame(() => tryFocus(attempt + 1))
      }
      tryFocus(0)
    },
    [],
  )

  const registerEngine = useCallback(
    (threadId: string, handle: EngineHandle | null) => {
      if (!handle) delete enginesRef.current[threadId]
      else enginesRef.current[threadId] = handle
      const busy = Boolean(handle?.isLoading)
      setBusyIds((current) => {
        if (current.has(threadId) === busy) return current
        const next = new Set(current)
        if (busy) next.add(threadId)
        else next.delete(threadId)
        return next
      })
    },
    [],
  )

  const stopGenerating = useCallback(() => {
    let stopped = false
    for (const handle of Object.values(enginesRef.current)) {
      if (!handle.isLoading) continue
      handle.stop()
      stopped = true
    }
    return stopped
  }, [])

  const syncChipFromSelection = useCallback(() => {
    const selection = window.getSelection()
    // Forget the range with the chip: the shortcut must never branch from a
    // passage the person has already deselected.
    const clear = () => {
      setChip(null)
      lastRangeRef.current = null
    }
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      if (!holdChipRef.current) clear()
      return
    }
    holdChipRef.current = false
    const range = snapRangeToWords(selection.getRangeAt(0))
    const el = selectableMessageFromRange(range)
    if (!el) {
      clear()
      return
    }
    const offsets = offsetsInRoot(el, range)
    if (!offsets) {
      clear()
      return
    }
    const threadId = el.dataset.threadId
    const messageId = el.dataset.messageId
    if (!threadId || !messageId) return
    const host = el.getBoundingClientRect()
    const rect = selectionClientRect(range) ?? {
      top: host.top,
      left: host.left + host.width / 2,
      bottom: host.bottom,
    }
    const next: ChipState = {
      threadId,
      messageId,
      start: offsets.start,
      end: offsets.end,
      quote: offsets.text.trim(),
      top: rect.top,
      left: rect.left,
      bottom: rect.bottom,
      range,
    }
    lastRangeRef.current = next
    setChip(next)
  }, [])

  const onSelectMessage = useCallback(
    (_threadId: string, _messageId: string) => {
      syncChipFromSelection()
    },
    [syncChipFromSelection],
  )

  const clearSelection = useCallback(() => {
    setChip(null)
    lastRangeRef.current = null
    holdChipRef.current = false
    window.getSelection()?.removeAllRanges()
  }, [])

  /** Open the question popover on a passage, optionally with what was typed. */
  const openAsk = useCallback((passage: ChipState, initial = '', returnFocus?: HTMLElement | null) => {
    setAsking({ passage, initial, returnFocus })
    setChip(null)
    lastRangeRef.current = null
    holdChipRef.current = false
  }, [])

  /** Grow the branch and give it the frame to the right of its source. */
  /**
   * `focusComposer`: a typed question moves on to the branch's composer; a
   * lens leaves focus where it was, so reading can carry on while it answers.
   */
  const startBranch = useCallback((passage: ChipState, question: string, options?: { webSearch?: boolean; focusComposer?: boolean }) => {
    const id = createThread(passage.threadId, {
      messageId: passage.messageId,
      start: passage.start,
      end: passage.end,
      quote: passage.quote,
    }, { webSearch: options?.webSearch })
    initialQuestionsRef.current[id] = question
    if (options?.focusComposer !== false) focusNextRef.current = id
    setAsking(null)
    clearSelection()
    focus(id)
  }, [clearSelection, createThread, focus])

  /**
   * With a key, web search costs extra per search. Say so the first time it
   * is switched on in this browser; the switch's tooltip says it after that.
   */
  const onWebSearchOn = useCallback(() => {
    if (status.mode !== 'live') return
    try {
      if (localStorage.getItem(WEB_SEARCH_COST_KEY)) return
      localStorage.setItem(WEB_SEARCH_COST_KEY, '1')
    } catch {
      // Without storage the note may repeat; that is fine.
    }
    onToast({
      id: createId('toast'),
      text: 'Web search is on: each search adds a small fee on your OpenRouter key.',
      actions: [{ label: 'Got it', onClick: () => undefined }],
    })
  }, [onToast, status.mode])

  const onExport = useCallback(() => {
    void exportChats(sessions).catch(() => onToast({ id: createId('toast'), text: 'Could not export your chats.', actions: [] }))
  }, [onToast, sessions])

  const importInput = useRef<HTMLInputElement>(null)
  const onImport = useCallback(async (file: File) => {
    try {
      const imported = parseImport(await file.text())
      await storeImportedAttachments(imported.attachments)
      // Mirrors the reducer: an identical chat already here is skipped.
      const count = imported.sessions.filter((session) =>
        !sessions.some((existing) => existing.id === session.id && existing.updatedAt === session.updatedAt)).length
      importSessions(imported.sessions)
      onToast({
        id: createId('toast'),
        text: count === 0 ? 'Those chats are already here.' : `Imported ${count} ${count === 1 ? 'chat' : 'chats'}`,
        actions: [],
      })
    } catch (error) {
      onToast({ id: createId('toast'), text: error instanceof Error ? error.message : 'Could not import that file.', actions: [] })
    }
  }, [importSessions, onToast, sessions])

  const onLens = useCallback((passage: ChipState, lens: Lens) => {
    // "Source?" wants evidence, so that branch searches the web from the start.
    if (lens.id === 'source') onWebSearchOn()
    startBranch(passage, lensQuestion(lens, passage.quote), { webSearch: lens.id === 'source', focusComposer: false })
  }, [onWebSearchOn, startBranch])

  const onAskMessage = useCallback((threadId: string, messageId: string) => {
    const element = document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"][data-thread-id="${CSS.escape(threadId)}"]`)
    if (!element) return
    const quote = plainTextSkippingIgnore(element)
    if (!quote.trim()) return
    const range = document.createRange()
    range.selectNodeContents(element)
    const rect = selectionClientRect(range) ?? { top: 0, left: window.innerWidth / 2, bottom: 0 }
    const button = document.querySelector<HTMLElement>(`[data-ask-message="${CSS.escape(messageId)}"]`)
    openAsk({ threadId, messageId, quote, start: 0, end: quote.length, ...rect, range }, '', button)
  }, [openAsk])

  /** Close the branch and land on its source — or, after a takeaway, on the takeaway. */
  const returnToPassage = useCallback((threadId: string, takeawayId?: string) => {
    const thread = state.threads[threadId]
    if (!thread?.parentId || !thread.anchor) return
    setAsking(null)
    expand(thread.parentId, null)
    focus(thread.parentId)
    setReturnTarget({ threadId: thread.parentId, messageId: thread.anchor.messageId, branchId: threadId, takeawayId })
  }, [state, expand, focus])

  useEffect(() => {
    if (!returnTarget || state.activeThreadId !== returnTarget.threadId) return
    let timer = 0
    let highlighted: HTMLElement | null = null
    const frame = requestAnimationFrame(() => {
      const source = returnTarget.takeawayId
        ? document.querySelector<HTMLElement>(`[data-takeaway-id="${CSS.escape(returnTarget.takeawayId)}"]`)
        : document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(returnTarget.messageId)}"][data-thread-id="${CSS.escape(returnTarget.threadId)}"]`)
      if (!source) return
      highlighted = returnTarget.takeawayId
        ? source
        : source.querySelector<HTMLElement>(`[data-mark-ids~="${CSS.escape(returnTarget.branchId)}"]`) ?? source
      const viewport = source.closest('[data-radix-scroll-area-viewport]')
      const bounds = viewport?.getBoundingClientRect()
      const rect = highlighted.getBoundingClientRect()
      if (bounds && (rect.top < bounds.top || rect.bottom > bounds.bottom)) highlighted.scrollIntoView({ block: 'center' })
      source.tabIndex = -1
      source.focus({ preventScroll: true })
      highlighted.classList.add('source-return')
      timer = window.setTimeout(() => highlighted?.classList.remove('source-return'), 2400)
    })
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
      highlighted?.classList.remove('source-return')
    }
  }, [returnTarget, state.activeThreadId])

  /** Branches open in the lane to the right; `null` closes whatever is there. */
  const onOpenChild = useCallback(
    (parentId: string, childId: string | null) => {
      if (childId) focusNextRef.current = childId
      focus(childId ?? parentId)
    },
    [focus],
  )

  /**
   * Open a cited source in a lane right after the thread citing it, closing
   * any deeper lanes (Miller columns). The same source again closes it.
   */
  const onOpenSource = useCallback((threadId: string, messageId: string, citationId: string) => {
    if (source?.threadId === threadId && source.messageId === messageId && source.citationId === citationId) {
      setSource(null)
      return
    }
    setAsking(null)
    focus(threadId)
    setSource({ threadId, messageId, citationId })
  }, [focus, source])

  const closeSource = useCallback(() => {
    if (!source) return
    setSource(null)
    // Back to the chip it opened from, so keyboard readers keep their place.
    requestAnimationFrame(() => document
      .querySelector<HTMLElement>(`[data-message-id="${CSS.escape(source.messageId)}"][data-thread-id="${CSS.escape(source.threadId)}"] [data-citation-id="${CSS.escape(source.citationId)}"] button`)
      ?.focus({ preventScroll: true }))
  }, [source])

  // Opening any other lane replaces the source: it only sits beside its
  // thread. Adjusted while rendering so a stale source never reappears later.
  const [sourceFrame, setSourceFrame] = useState(activeThread.id)
  if (sourceFrame !== activeThread.id) {
    setSourceFrame(activeThread.id)
    if (source && source.threadId !== activeThread.id) setSource(null)
  }

  const onMerge = useCallback(
    (threadId: string) => {
      const thread = state.threads[threadId]
      if (!thread || !thread.parentId || !thread.anchor) return
      enginesRef.current[threadId]?.stop()
      setPreviewThreadId(threadId)
    },
    [state],
  )

  const discardWithUndo = useCallback((threadId: string) => {
    const removed = descendantIds(state, threadId).flatMap((id) => state.threads[id] ? [state.threads[id]] : [])
    if (removed.length === 0) return
    const focusedBefore = state.activeThreadId
    for (const thread of removed) enginesRef.current[thread.id]?.stop()
    discard(threadId)
    onToast({
      id: createId('toast'),
      text: 'Branch discarded',
      actions: [{ label: 'Undo', onClick: () => restoreThreads(removed, focusedBefore) }],
    })
  }, [discard, onToast, restoreThreads, state])

  const deleteWithUndo = useCallback((sessionId: string) => {
    const session = sessions.find((entry) => entry.id === sessionId)
    if (!session) return
    deleteSession(sessionId)
    onToast({
      id: createId('toast'),
      text: `Deleted “${session.title}”`,
      actions: [{ label: 'Undo', onClick: () => restoreSession(session) }],
    })
  }, [deleteSession, onToast, restoreSession, sessions])

  const narrow = useNarrow()

  // Phones: swipe right from anywhere in a branch to go back to its passage.
  // Starts inside something that scrolls sideways (code, tables) don't count.
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const onSwipeStart = (event: TouchEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    swipe.current = narrow && event.touches.length === 1 && !target.closest('pre, .tc-md-table-wrap, textarea, [data-branch-sheet]')
      ? { x: event.touches[0]!.clientX, y: event.touches[0]!.clientY }
      : null
  }
  const onSwipeEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = swipe.current
    swipe.current = null
    const touch = event.changedTouches[0]
    if (!start || !touch || !activeThread.parentId || window.getSelection()?.isCollapsed === false) return
    const dx = touch.clientX - start.x
    const dy = Math.abs(touch.clientY - start.y)
    if (dx > 80 && dy < 50) returnToPassage(activeThread.id)
  }

  const onRenameChat = useCallback((title: string) => renameSession(activeSessionId, title), [activeSessionId, renameSession])
  const onDeleteChat = useCallback(() => deleteWithUndo(activeSessionId), [activeSessionId, deleteWithUndo])

  const shell = useMemo<ShellValue>(
    () => ({
      draftFor,
      setDraft,
      attachmentsFor,
      setAttachments: onAttachmentsChange,
      status,
      onSwitchModel,
      registerComposer,
      registerEngine,
      onSelectMessage,
      onOpenChild,
      onFocus: focus,
      onMerge,
      onDiscard: discardWithUndo,
      takeInitialQuestion,
      onAskMessage,
      onReturn: returnToPassage,
      scrollPositions,
      sessionId: activeSessionId,
      onShowDemo: onRestoreDemo,
      openSource: source,
      onOpenSource,
      narrow,
      onRenameChat,
      onDeleteChat,
      onWebSearchOn,
    }),
    [
      draftFor,
      setDraft,
      attachmentsFor,
      onAttachmentsChange,
      status,
      onSwitchModel,
      registerComposer,
      registerEngine,
      onSelectMessage,
      onOpenChild,
      focus,
      onMerge,
      discardWithUndo,
      takeInitialQuestion,
      onAskMessage,
      returnToPassage,
      scrollPositions,
      activeSessionId,
      onRestoreDemo,
      source,
      onOpenSource,
      narrow,
      onRenameChat,
      onDeleteChat,
      onWebSearchOn,
    ],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }
      if (event.defaultPrevented || document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      if (isBranchShortcut(event)) {
        event.preventDefault()
        const range = chip ?? lastRangeRef.current
        if (range) openAsk(range)
        return
      }
      // With a passage selected, just start typing to ask about it. The chip
      // only exists while the selection sits in a message, so keys go nowhere
      // useful otherwise — even if a composer still holds focus.
      const typing = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.trim()
      if (chip && typing) {
        event.preventDefault()
        openAsk(chip, event.key)
        return
      }
      if (event.key !== 'Escape') return
      if (stopGenerating()) {
        event.preventDefault()
        return
      }
      if (chip) {
        event.preventDefault()
        clearSelection()
        return
      }
      // The source lane is the rightmost lane, so it closes first.
      if (source) {
        event.preventDefault()
        closeSource()
        return
      }
      const parentId = activeThread.parentId
      if (!parentId) return
      const composer = composersRef.current[activeThread.id]
      const dirty = (drafts[activeThread.id] ?? '').trim().length > 0
      if (composer && composer === document.activeElement && dirty) {
        composer.blur()
        event.preventDefault()
        return
      }
      event.preventDefault()
      returnToPassage(activeThread.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeThread, chip, clearSelection, closeSource, drafts, openAsk, returnToPassage, source, stopGenerating])

  useEffect(() => {
    let frame = 0
    const sync = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        syncChipFromSelection()
      })
    }
    document.addEventListener('selectionchange', sync)
    window.addEventListener('scroll', sync, true)
    window.addEventListener('resize', sync)
    return () => {
      document.removeEventListener('selectionchange', sync)
      window.removeEventListener('scroll', sync, true)
      window.removeEventListener('resize', sync)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [syncChipFromSelection])

  const onSelectSession = useCallback(
    (sessionId: string) => {
      switchSession(sessionId)
      setLibraryOpen(false)
    },
    [switchSession],
  )
  const lanePath = useMemo(() => pathTo(state, activeThread.id), [state, activeThread.id])
  const sourceCitation = source ? citationFor(state.threads[source.threadId]?.messages, source) : undefined
  const trailing = useMemo<TrailingLane | null>(() => {
    if (!source || !sourceCitation || source.threadId !== activeThread.id) return null
    const message = `[data-message-id="${CSS.escape(source.messageId)}"]`
    const cite = `[data-citation-id="${CSS.escape(sourceCitation.id)}"]`
    return {
      id: SOURCE_LANE_ID,
      title: sourceCitation.title,
      label: `Source: ${sourceCitation.title}`,
      testId: 'source-lane',
      ownerId: source.threadId,
      // The chip in the reply; the sources list when the text never cites it.
      selector: `${message} ${cite}, [data-sources-for="${CSS.escape(source.messageId)}"] ${cite}`,
      render: (frame) => (
        <SourceLane
          key={`${source.messageId}:${sourceCitation.id}`}
          laneId={SOURCE_LANE_ID}
          citation={sourceCitation}
          leadOffset={frame.leadOffset}
          narrow={narrow}
          onClose={closeSource}
        />
      ),
    }
  }, [activeThread.id, closeSource, narrow, source, sourceCitation])
  const sessionList = (inDialog: boolean) => (
    <SessionList
      sessions={sessions}
      activeSessionId={activeSessionId}
      onSelect={(sessionId) => {
        // The open chat's row goes back to its main thread.
        if (sessionId === activeSessionId) focus(state.rootId)
        onSelectSession(sessionId)
      }}
      onRename={renameSession}
      onDelete={(sessionId) => {
        if (inDialog) setLibraryOpen(false)
        deleteWithUndo(sessionId)
      }}
      alwaysShowActions={inDialog}
      activeTree={
        <TreeRail
          state={state}
          sessionId={activeSessionId}
          rootTitle={activeSession.title}
          busyIds={busyIds}
          onFocus={(threadId) => {
            focus(threadId)
            if (inDialog) setLibraryOpen(false)
          }}
        />
      }
    />
  )

  const demoStatus = status.mode === 'mock' ? (
    <button
      type="button"
      data-testid="provider-mode"
      onClick={() => setSettingsOpen(true)}
      title="Replies are demo text. Add an OpenRouter key for real answers."
      className="btn h-7 shrink-0 px-2 text-xs"
    >
      Demo · Add key
    </button>
  ) : null

  return (
    <div
      className="flex h-svh flex-col bg-background"
      data-view={activeThread.parentId ? 'conversation' : 'spine'}
    >
      {/* Phones only: there is no sidebar, so the chat and its actions live here. */}
      {narrow ? (
        <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2">
          <span className="accent-glow mx-2 size-[7px] shrink-0 rounded-sm bg-branch" aria-hidden />
          <button
            type="button"
            onClick={() => setLibraryOpen(true)}
            aria-label="Branches and chats"
            title={activeSession.title}
            data-testid="session-switcher"
            className="flex h-9 min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 text-[13px] font-medium text-foreground hover:bg-foreground/[0.06]"
          >
            <span className="truncate" data-testid="session-title">{activeSession.title}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
          <button type="button" onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings" data-testid="settings-button" className="icon-button">
            <Settings className="size-4" />
          </button>
          <button type="button" onClick={onNewChat} aria-label="New chat" title="New chat" data-testid="new-chat" className="icon-button">
            <SquarePen className="size-4" />
          </button>
        </header>
      ) : null}

      <ShellContext.Provider value={shell}>
        <div className="flex min-h-0 flex-1">
          {narrow ? null : (
            <Sidebar
              onHome={() => focus(state.rootId)}
              onNewChat={onNewChat}
              onOpenSettings={() => setSettingsOpen(true)}
              chats={sessionList(false)}
              documents={<DocumentsSidebarSection onOpen={() => setDocumentsOpen(true)} />}
              status={demoStatus}
            />
          )}
          <div className="relative flex min-w-0 flex-1 flex-col" onTouchStart={onSwipeStart} onTouchEnd={onSwipeEnd}>
            {asking ? (
              <BranchPopover
                key={`${asking.passage.messageId}:${asking.passage.start}:${asking.passage.end}`}
                mode="ask"
                sheet={narrow}
                anchor={asking.passage}
                range={asking.passage.range}
                quote={asking.passage.quote}
                initialQuestion={asking.initial}
                onLens={(lens) => onLens(asking.passage, lens)}
                onAsk={(question) => startBranch(asking.passage, question)}
                onOpenAsk={() => undefined}
                onCancel={() => {
                  asking.returnFocus?.focus({ preventScroll: true })
                  setAsking(null)
                }}
              />
            ) : chip ? (
              <BranchPopover
                mode="lenses"
                sheet={narrow}
                anchor={chip}
                quote={chip.quote}
                onLens={(lens) => onLens(chip, lens)}
                onAsk={(question) => startBranch(chip, question)}
                onOpenAsk={() => openAsk(chip)}
                onCancel={clearSelection}
                onHold={() => {
                  holdChipRef.current = true
                }}
              />
            ) : null}
            {toast ? <Toast toast={toast} onDismiss={dismissToast} /> : null}
            {storageFull ? (
              <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-[13px] text-foreground" role="alert" data-testid="storage-full">
                <span className="min-w-0 flex-1">
                  This browser’s storage is full, so recent changes are not being saved. Export your chats, then delete
                  some you no longer need.
                </span>
                <button type="button" className="btn btn-outline" onClick={onExport}>Export chats</button>
              </div>
            ) : null}
            <div className="min-h-0 flex-1">
              <Lanes
                path={lanePath}
                single={narrow}
                rootTitle={activeSession.title}
                trailing={trailing}
                busyIds={busyIds}
                renderLane={(thread, frame) => {
                  const index = lanePath.findIndex((entry) => entry.id === thread.id)
                  return (
                    <ThreadEngine
                      key={`${thread.id}:${thread.rev}:${epoch}`}
                      threadId={thread.id}
                      openChildId={lanePath[index + 1]?.id ?? null}
                      frame={frame}
                    />
                  )
                }}
              />
            </div>
          </div>
        </div>
      </ShellContext.Provider>

      <DocumentsDialog open={documentsOpen} onOpenChange={setDocumentsOpen} />
      <DocumentDropZone onDropped={() => setDocumentsOpen(true)} />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onConfigChange={onProviderConfigChange}
        onRestoreDemo={onRestoreDemo}
        onExport={onExport}
        onImport={(file) => void onImport(file)}
      />
      <input
        ref={importInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void onImport(file)
        }}
      />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        sessions={sessions}
        activeSessionId={activeSessionId}
        state={state}
        activeThreadId={activeThread.id}
        onSwitchChat={onSelectSession}
        onFocusThread={focus}
        onNewChat={onNewChat}
        onToggleWebSearch={() => {
          if (!activeThread.webSearch) onWebSearchOn()
          setWebSearch(activeThread.id, !activeThread.webSearch)
        }}
        onExport={onExport}
        onImport={() => importInput.current?.click()}
        webSearch={Boolean(activeThread.webSearch)}
        onOpenDocuments={() => setDocumentsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onShowDemo={onRestoreDemo}
      />

      {previewThreadId && state.threads[previewThreadId] ? (
        <TakeawayDialog key={previewThreadId} thread={state.threads[previewThreadId]} state={state} onClose={() => setPreviewThreadId(null)} onConfirm={(content) => {
          const thread = state.threads[previewThreadId]
          if (!thread?.parentId || !thread.anchor || !state.threads[thread.parentId]) return
          const parentId = thread.parentId
          enginesRef.current[parentId]?.stop()
          const id = createId('takeaway')
          appendMessage(parentId, { id, role: 'assistant', content, createdAt: Date.now(), kind: 'drop-summary', quote: thread.anchor.quote, sourceThreadId: thread.id })
          setPreviewThreadId(null)
          onToast({
            id: createId('toast'),
            text: 'Takeaway added',
            actions: [
              {
                label: 'View takeaway',
                keepOpen: true,
                onClick: () => {
                  focus(parentId)
                  requestAnimationFrame(() => document.querySelector(`[data-takeaway-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' }))
                },
              },
              {
                label: 'Undo',
                onClick: () => {
                  enginesRef.current[parentId]?.stop()
                  undoTakeaway(parentId, id)
                },
              },
            ],
          })
          returnToPassage(thread.id, id)
        }} />
      ) : null}

      <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
        <DialogContent className="flex max-h-[85svh] max-w-sm flex-col gap-4" data-testid="session-library">
          <DialogHeader>
            <DialogTitle>Chats</DialogTitle>
            <DialogDescription className="sr-only">Switch chats, or jump to a branch of this one.</DialogDescription>
          </DialogHeader>
          <div className="-mx-2 flex min-h-0 flex-col">{sessionList(true)}</div>
          <DocumentsLibraryEntry onOpen={() => {
            setLibraryOpen(false)
            setDocumentsOpen(true)
          }} />
        </DialogContent>
      </Dialog>
    </div>
  )
}

function citationFor(messages: ChatMessage[] | undefined, source: OpenSource): Citation | undefined {
  return messages?.find((message) => message.id === source.messageId)?.citations?.find((citation) => citation.id === source.citationId)
}

/** Phones get one lane at a time; there is no room for depth side by side. */
function useNarrow() {
  const query = '(max-width: 767px)'
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setNarrow(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return narrow
}

function resolveStatus(
  clientConfig: ClientProviderConfig | null,
  serverStatus: ProviderStatus,
): ProviderStatus {
  if (clientConfig?.apiKey) {
    return {
      mode: 'live',
      provider: 'openrouter',
      model: clientConfig.model || DEFAULT_OPENROUTER_MODEL,
    }
  }
  return {
    mode: serverStatus.mode,
    provider: serverStatus.provider,
    model:
      clientConfig?.model ||
      (serverStatus.provider === 'mock' ? DEFAULT_OPENROUTER_MODEL : serverStatus.model),
  }
}

export function TreeChatApp() {
  const { restoreDemo, createSession, switchSession, sessions, activeSessionId } = useTree()

  // Once per visit, when idle: forget stored files no chat refers to. Recent
  // ones stay — they may sit in a composer here or in another tab.
  const sessionsRef = useRef(sessions)
  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])
  useEffect(() => {
    const prune = () => {
      const referenced = new Set<string>()
      for (const session of sessionsRef.current) {
        for (const thread of Object.values(session.treeState.threads)) {
          for (const message of thread.messages) for (const file of message.attachments ?? []) referenced.add(file.id)
        }
      }
      void pruneAttachments(referenced, Date.now() - ATTACHMENT_GRACE_MS).catch(() => undefined)
    }
    const idle = window.requestIdleCallback?.(prune, { timeout: 10_000 }) ?? window.setTimeout(prune, 5_000)
    return () => {
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle)
      else window.clearTimeout(idle)
    }
  }, [])
  const [epoch, setEpoch] = useState(0)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [draftsBySession, setDraftsBySession] = useState<Record<string, Record<string, string>>>({})
  const [attachmentsBySession, setAttachmentsBySession] = useState<Record<string, Record<string, Attachment[]>>>({})
  const onAttachmentsChange = useCallback((threadId: string, update: (current: Attachment[]) => Attachment[]) => {
    setAttachmentsBySession((current) => ({
      ...current,
      [activeSessionId]: { ...current[activeSessionId], [threadId]: update(current[activeSessionId]?.[threadId] ?? []) },
    }))
  }, [activeSessionId])
  const [scrollPositions] = useState(() => new Map<string, number>())
  const onDraftChange = useCallback((threadId: string, value: string) => {
    setDraftsBySession((current) => ({
      ...current,
      [activeSessionId]: { ...current[activeSessionId], [threadId]: value },
    }))
  }, [activeSessionId])
  const [clientConfig, setClientConfig] = useState<ClientProviderConfig | null>(
    () => loadProviderConfig(),
  )
  const [serverStatus, setServerStatus] = useState<ProviderStatus>(idleStatus)
  const status = resolveStatus(clientConfig, serverStatus)

  const onSwitchModel = useCallback((model: string) => {
    setClientConfig(patchProviderConfig({ model }))
  }, [])

  const onProviderConfigChange = useCallback((config: ClientProviderConfig | null) => {
    setClientConfig(config)
  }, [])


  const bumpEpoch = useCallback(() => {
    setEpoch((value) => value + 1)
  }, [])

  const onNewChat = useCallback(() => {
    // A chat with no messages, branches, or drafts is already a new chat.
    // Reuse it rather than stacking identical "New chat" rows.
    const blank = (session: ChatSession) => {
      const tree = session.treeState
      return Object.keys(tree.threads).length === 1
        && (tree.threads[tree.rootId]?.messages.length ?? 1) === 0
        && !Object.values(draftsBySession[session.id] ?? {}).some((draft) => draft.trim())
        && !Object.values(attachmentsBySession[session.id] ?? {}).some((files) => files.length > 0)
    }
    const active = sessions.find((session) => session.id === activeSessionId)
    const reusable = active && blank(active) ? active : sessions.find(blank)
    if (!reusable) createSession()
    else if (reusable.id !== activeSessionId) switchSession(reusable.id)
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-testid="thread-composer"]')?.focus())
  }, [activeSessionId, attachmentsBySession, createSession, draftsBySession, sessions, switchSession])

  const onRestoreDemo = useCallback(() => {
    setDraftsBySession((current) => ({ ...current, [activeSessionId]: {} }))
    restoreDemo()
    bumpEpoch()
  }, [activeSessionId, bumpEpoch, restoreDemo])

  useEffect(() => {
    if (clientConfig?.apiKey) return
    let cancelled = false
    fetch('/api/status', { headers: providerRequestHeaders() })
      .then(async (response) => {
        if (!response.ok) throw new Error('no local api')
        return (await response.json()) as ProviderStatus
      })
      .then((data) => {
        if (!cancelled) setServerStatus(data)
      })
      .catch(() => {
        if (!cancelled) setServerStatus(idleStatus)
      })
    return () => {
      cancelled = true
    }
  }, [epoch, clientConfig])

  return (
    <TreeChatShell
      key={`${activeSessionId}:${epoch}`}
      epoch={epoch}
      status={status}
      drafts={draftsBySession[activeSessionId] ?? {}}
      onDraftChange={onDraftChange}
      attachments={attachmentsBySession[activeSessionId] ?? NO_THREAD_ATTACHMENTS}
      onAttachmentsChange={onAttachmentsChange}
      onSwitchModel={onSwitchModel}
      scrollPositions={scrollPositions}
      onProviderConfigChange={onProviderConfigChange}
      onNewChat={onNewChat}
      onRestoreDemo={onRestoreDemo}
      toast={toast}
      onToast={setToast}
    />
  )
}
