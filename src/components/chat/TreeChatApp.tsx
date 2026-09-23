import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useChat } from '@tanstack/ai-react'
import { ChevronDown, Settings, SquarePen } from 'lucide-react'
import { BranchHeader } from '@/components/chat/BranchHeader'
import { BranchPopover } from '@/components/chat/BranchPopover'
import { Lanes, type LaneFrame } from '@/components/chat/Lanes'
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
import { chatConnection } from '@/lib/chat-connection'
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
  loadProviderConfig,
  providerRequestHeaders,
  type ClientProviderConfig,
} from '@/lib/provider'
import { lensQuestion, type Lens } from '@/lib/lenses'
import {
  offsetsInRoot,
  selectableMessageFromRange,
  selectionClientRect,
  plainTextSkippingIgnore,
  snapRangeToWords,
} from '@/lib/selection'
import { branchForwardedProps, pathTo } from '@/lib/tree'
import { refreshSummary } from '@/lib/summarize'
import { isBranchShortcut } from '@/lib/utils'
import { useTree } from '@/store/tree-store'
import type { ChatMessage, ChatSession, ProviderStatus } from '@/types'

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

type ShellValue = {
  draftFor: (threadId: string) => string
  setDraft: (threadId: string, value: string) => void
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
}

const ShellContext = createContext<ShellValue | null>(null)

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
  const { state, replaceMessages, rewriteThread, setSummary } = useTree()
  const shell = useShell()
  const thread = state.threads[threadId]

  const [initialMessages] = useState(() => toUIMessages(thread?.messages ?? []))
  const forwarded = branchForwardedProps(state, threadId)
  const summary = thread?.summary
  const chat = useChat({
    threadId,
    connection: chatConnection,
    initialMessages,
    forwardedProps: {
      ...forwarded,
      cacheSessionId: shell.sessionId,
      ...(summary ? { threadSummary: { content: summary.content, throughMessageId: summary.throughMessageId } } : {}),
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

  if (!thread) return null

  const snapshot = () => {
    const live = fromUIMessages(chat.messages)
    return live.length > 0 ? live : thread.messages
  }

  const send = () => {
    const text = shell.draftFor(threadId).trim()
    if (!text) return
    shell.setDraft(threadId, '')
    void chat.sendMessage(text)
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
      onAskMessage={shell.onAskMessage}
      leadOffset={frame.leadOffset}
      header={thread.parentId ? (
        <BranchHeader
          thread={thread}
          onMerge={() => shell.onMerge(threadId)}
          onDiscard={() => shell.onDiscard(threadId)}
          onReturn={() => shell.onReturn(threadId)}
          summarized={Object.values(state.threads).some((entry) => entry.messages.some((message) => message.sourceThreadId === threadId))}
          controls={frame.controls}
        />
      ) : frame.controls ? (
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate py-2 text-sm text-muted-foreground">Main conversation</span>
          {frame.controls}
        </div>
      ) : undefined}
      draft={shell.draftFor(threadId)}
      onDraftChange={(value) => shell.setDraft(threadId, value)}
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
            ? 'Message…'
            : 'Reply on the main thread…'
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
  scrollPositions,
}: {
  epoch: number
  status: ProviderStatus
  onNewChat: () => void
  onRestoreDemo: () => void
  onProviderConfigChange: (config: ClientProviderConfig | null) => void
  drafts: Record<string, string>
  onDraftChange: (threadId: string, value: string) => void
  scrollPositions: Map<string, number>
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
    appendMessage,
    undoTakeaway,
    switchSession,
    renameSession,
    deleteSession,
  } = useTree()

  const [chip, setChip] = useState<ChipState | null>(null)
  /** A question being written about a passage, in the popover beside it. */
  const [asking, setAsking] = useState<{ passage: ChipState; initial: string; returnFocus?: HTMLElement | null } | null>(null)
  const [previewThreadId, setPreviewThreadId] = useState<string | null>(null)
  const [returnTarget, setReturnTarget] = useState<{ threadId: string; messageId: string; branchId: string; takeawayId?: string } | null>(null)
  const [lastTakeaway, setLastTakeaway] = useState<{ threadId: string; messageId: string } | null>(null)
  const dismissTakeaway = useCallback(() => setLastTakeaway(null), [])
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const composersRef = useRef<Record<string, HTMLTextAreaElement | null>>({})
  const enginesRef = useRef<Record<string, EngineHandle>>({})
  const lastRangeRef = useRef<ChipState | null>(null)
  const focusNextRef = useRef<string | null>(null)
  const holdChipRef = useRef(false)
  const initialQuestionsRef = useRef<Record<string, string>>({})

  const draftFor = useCallback((threadId: string) => drafts[threadId] ?? '', [drafts])
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
      if (!handle) {
        delete enginesRef.current[threadId]
        return
      }
      enginesRef.current[threadId] = handle
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
  const startBranch = useCallback((passage: ChipState, question: string) => {
    const id = createThread(passage.threadId, {
      messageId: passage.messageId,
      start: passage.start,
      end: passage.end,
      quote: passage.quote,
    })
    initialQuestionsRef.current[id] = question
    focusNextRef.current = id
    setAsking(null)
    clearSelection()
    focus(id)
  }, [clearSelection, createThread, focus])

  const onLens = useCallback((passage: ChipState, lens: Lens) => {
    startBranch(passage, lensQuestion(lens, passage.quote))
  }, [startBranch])

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

  const onMerge = useCallback(
    (threadId: string) => {
      const thread = state.threads[threadId]
      if (!thread || !thread.parentId || !thread.anchor) return
      enginesRef.current[threadId]?.stop()
      setPreviewThreadId(threadId)
    },
    [state],
  )

  const shell = useMemo<ShellValue>(
    () => ({
      draftFor,
      setDraft,
      registerComposer,
      registerEngine,
      onSelectMessage,
      onOpenChild,
      onFocus: focus,
      onMerge,
      onDiscard: discard,
      takeInitialQuestion,
      onAskMessage,
      onReturn: returnToPassage,
      scrollPositions,
      sessionId: activeSessionId,
      onShowDemo: onRestoreDemo,
    }),
    [
      draftFor,
      setDraft,
      registerComposer,
      registerEngine,
      onSelectMessage,
      onOpenChild,
      focus,
      onMerge,
      discard,
      takeInitialQuestion,
      onAskMessage,
      returnToPassage,
      scrollPositions,
      activeSessionId,
      onRestoreDemo,
    ],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
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
  }, [activeThread, chip, clearSelection, drafts, openAsk, returnToPassage, stopGenerating])

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

  const pendingDelete = sessions.find((session) => session.id === pendingDeleteId)
  const onSelectSession = useCallback(
    (sessionId: string) => {
      switchSession(sessionId)
      setLibraryOpen(false)
    },
    [switchSession],
  )
  const hasBranches = Object.keys(state.threads).length > 1
  const lanePath = useMemo(() => pathTo(state, activeThread.id), [state, activeThread.id])
  const narrow = useNarrow()
  return (
    <div
      className="flex h-svh flex-col bg-background"
      data-view={activeThread.parentId ? 'conversation' : 'spine'}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-3 sm:gap-3 sm:px-8">
        <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
          <span className="accent-glow size-[7px] shrink-0 rounded-sm bg-branch" />
          <button
            type="button"
            onClick={() => focus(state.rootId)}
            className="shrink-0 text-[12.5px] font-medium text-foreground"
          >
            TreeChat
          </button>
          <span className="hidden shrink-0 text-[12px] text-muted-foreground md:inline">/</span>
          <span
            className="hidden min-w-0 truncate text-[12px] text-muted-foreground md:inline"
            title={activeSession.title}
            data-testid="session-title"
          >
            {activeSession.title}
          </span>
          <button
            type="button"
            onClick={() => setLibraryOpen(true)}
            aria-label="Branches and chats"
            title={activeSession.title}
            data-testid="session-switcher"
            className="flex min-w-0 max-w-[52vw] items-center gap-1 truncate rounded-md px-1.5 py-[3px] text-[12px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground md:hidden"
          >
            <span className="truncate">{activeSession.title}</span>
            <ChevronDown className="size-3.5 shrink-0" />
          </button>

        </div>
        <div className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-2.5">
          {status.mode === 'mock' ? (
            <button
              type="button"
              data-testid="provider-mode"
              onClick={() => setSettingsOpen(true)}
              title="Replies are demo text. Add an OpenRouter key for real answers."
              className="rounded-md border border-dashed border-border px-2 py-[3px] text-[11px] text-muted-foreground transition-colors hover:border-branch/50 hover:text-foreground"
            >
              Demo replies<span className="hidden sm:inline"> · Add key</span>
            </button>
          ) : null}
          {/* Phones have no sidebar, so its two actions live up here. */}
          {narrow ? (
            <>
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                aria-label="Settings"
                title="Settings"
                data-testid="settings-button"
                className="flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <Settings className="size-4" />
              </button>
              <button
                type="button"
                onClick={onNewChat}
                aria-label="New chat"
                title="New chat"
                data-testid="new-chat"
                className="flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <SquarePen className="size-4" />
              </button>
            </>
          ) : null}
        </div>
      </header>

      <ShellContext.Provider value={shell}>
        <div className="flex min-h-0 flex-1">
          {narrow ? null : (
            <Sidebar
              onNewChat={onNewChat}
              onOpenSettings={() => setSettingsOpen(true)}
              tree={
                <TreeRail
                  state={state}
                  sessionId={activeSessionId}
                  rootTitle={activeSession.title}
                  onFocus={focus}
                />
              }
              sessions={
                <SessionList
                  sessions={sessions}
                  activeSessionId={activeSessionId}
                  onSelect={onSelectSession}
                  onRename={renameSession}
                  onDelete={setPendingDeleteId}
                />
              }
            />
          )}
          <div className="relative flex min-w-0 flex-1 flex-col">
            {asking ? (
              <BranchPopover
                key={`${asking.passage.messageId}:${asking.passage.start}:${asking.passage.end}`}
                mode="ask"
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
            {lastTakeaway ? (
              <TakeawayNotice
                onView={() => {
                  focus(lastTakeaway.threadId)
                  requestAnimationFrame(() => document.querySelector(`[data-takeaway-id="${CSS.escape(lastTakeaway.messageId)}"]`)?.scrollIntoView({ block: 'center' }))
                }}
                onUndo={() => {
                  enginesRef.current[lastTakeaway.threadId]?.stop()
                  undoTakeaway(lastTakeaway.threadId, lastTakeaway.messageId)
                  setLastTakeaway(null)
                }}
                onDismiss={dismissTakeaway}
              />
            ) : null}
            <div className="min-h-0 flex-1">
              <Lanes
                path={lanePath}
                single={narrow}
                rootTitle={activeSession.title}
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

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onConfigChange={onProviderConfigChange}
        onRestoreDemo={onRestoreDemo}
      />

      {previewThreadId && state.threads[previewThreadId] ? (
        <TakeawayDialog key={previewThreadId} thread={state.threads[previewThreadId]} state={state} onClose={() => setPreviewThreadId(null)} onConfirm={(content) => {
          const thread = state.threads[previewThreadId]
          if (!thread?.parentId || !thread.anchor || !state.threads[thread.parentId]) return
          enginesRef.current[thread.parentId]?.stop()
          const id = createId('takeaway')
          appendMessage(thread.parentId, { id, role: 'assistant', content, createdAt: Date.now(), kind: 'drop-summary', quote: thread.anchor.quote, sourceThreadId: thread.id })
          setPreviewThreadId(null)
          setLastTakeaway({ threadId: thread.parentId, messageId: id })
          returnToPassage(thread.id, id)
        }} />
      ) : null}

      <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
        <DialogContent className="flex max-h-[85svh] max-w-sm flex-col gap-4 sm:rounded-lg" data-testid="session-library">
          <DialogHeader>
            <DialogTitle>{hasBranches ? 'Branches & chats' : 'Chats'}</DialogTitle>
            <DialogDescription>
              {hasBranches ? 'Jump to a branch, or switch chats.' : 'Switch or rename chats.'}
            </DialogDescription>
          </DialogHeader>
          {hasBranches ? (
            <div className="-mx-3.5 flex max-h-[40svh] min-h-0 flex-col border-b border-border pb-2">
              <TreeRail
                state={state}
                sessionId={activeSessionId}
                rootTitle={activeSession.title}
                onFocus={(threadId) => {
                  focus(threadId)
                  setLibraryOpen(false)
                }}
              />
            </div>
          ) : null}
          <SessionList
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelect={onSelectSession}
            onRename={renameSession}
            onDelete={(sessionId) => {
              setLibraryOpen(false)
              setPendingDeleteId(sessionId)
            }}
            alwaysShowActions
          />
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null)
        }}
      >
        <AlertDialogContent data-testid="session-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              “{pendingDelete?.title}” and its branches will be removed. This cannot
              be undone. Other chats stay as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep chat</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="session-delete-confirm-action"
              onClick={() => {
                if (pendingDelete) deleteSession(pendingDelete.id)
                setPendingDeleteId(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/**
 * Confirms a takeaway without pushing the conversation down, and leaves on
 * its own. Hovering or focusing it holds it open so Undo stays reachable.
 */
function TakeawayNotice({ onView, onUndo, onDismiss }: {
  onView: () => void
  onUndo: () => void
  onDismiss: () => void
}) {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (held) return
    const timer = window.setTimeout(onDismiss, 10_000)
    return () => window.clearTimeout(timer)
  }, [held, onDismiss])
  return (
    <div
      className="rise absolute inset-x-0 top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-branch/20 bg-paper/95 px-5 py-2 text-sm shadow-lg backdrop-blur"
      role="status"
      data-testid="takeaway-notice"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <span>Takeaway added</span>
      <div className="flex items-center gap-2">
        <button type="button" className="branch-secondary" onClick={onView}>View takeaway</button>
        <button type="button" className="branch-secondary" onClick={onUndo}>Undo</button>
        <button type="button" className="branch-icon-button" aria-label="Dismiss takeaway notice" onClick={onDismiss}>×</button>
      </div>
    </div>
  )
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
  const [epoch, setEpoch] = useState(0)
  const [draftsBySession, setDraftsBySession] = useState<Record<string, Record<string, string>>>({})
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
    }
    const active = sessions.find((session) => session.id === activeSessionId)
    const reusable = active && blank(active) ? active : sessions.find(blank)
    if (!reusable) createSession()
    else if (reusable.id !== activeSessionId) switchSession(reusable.id)
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-testid="thread-composer"]')?.focus())
  }, [activeSessionId, createSession, draftsBySession, sessions, switchSession])

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
      scrollPositions={scrollPositions}
      onProviderConfigChange={onProviderConfigChange}
      onNewChat={onNewChat}
      onRestoreDemo={onRestoreDemo}
    />
  )
}
