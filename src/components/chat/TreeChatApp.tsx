import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type TouchEvent,
} from 'react'
import { ChevronDown, Settings, SquarePen } from 'lucide-react'
import { BranchPopover } from '@/components/chat/BranchPopover'
import { ThreadRunners } from '@/components/chat/thread-runs'
import { queueQuestion, stopChat, stopThread, useBusyThreads } from '@/lib/thread-run-registry'
import { DocumentDropZone, DocumentsLibraryEntry, DocumentsSidebarSection } from '@/components/chat/Documents'
import { Toast, type ToastState } from '@/components/chat/Toast'
import { Lanes, type TrailingLane } from '@/components/chat/Lanes'
import { SessionList } from '@/components/chat/SessionList'
import { Sidebar } from '@/components/chat/Sidebar'
import { TreeRail } from '@/components/chat/TreeRail'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { pruneAttachments } from '@/lib/attachments/store'
import { createId } from '@/lib/ids'
import {
  DEFAULT_OPENROUTER_MODEL,
  loadProviderConfig,
  patchProviderConfig,
  type ClientProviderConfig,
} from '@/lib/provider'
import { lensQuestion, type Lens } from '@/lib/lenses'
import {
  selectionClientRect,
  plainTextSkippingIgnore,
} from '@/lib/selection'
import { descendantIds, pathTo } from '@/lib/tree'
import { isBranchShortcut } from '@/lib/utils'
import { useTree } from '@/store/tree-store'
import type { Attachment, ChatMessage, ChatSession, Citation, ProviderStatus } from '@/types'

import { ThreadLane } from '@/components/chat/ThreadLane'
import { usePassageSelection } from '@/components/chat/use-passage-selection'
import { useChatTransfer } from '@/components/chat/use-chat-transfer'
import { CommandPalette, DocumentsDialog, SettingsDialog, SourceLane, TakeawayDialog, useOpenedOnce, usePrefetchLazyParts } from '@/components/chat/lazy-parts'
import { ShellContext, type ChipState, type OpenSource, type ShellValue } from '@/components/chat/shell-context'
/** Unreferenced attachments younger than this survive a clean-up. */
const ATTACHMENT_GRACE_MS = 24 * 60 * 60 * 1000

const SOURCE_LANE_ID = 'source-lane'
/** Set once the web search cost has been mentioned in this browser. */
const WEB_SEARCH_COST_KEY = 'treechat:web-search-cost-seen'

/** Stable empties, so memoized consumers don't see a new array every render. */
const NO_ATTACHMENTS: Attachment[] = []
const NO_THREAD_ATTACHMENTS: Record<string, Attachment[]> = {}

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

  const { chip, lastPassage, clearSelection, forget: forgetPassage, hold: holdPassage, onSelectMessage } = usePassageSelection()
  /** A question being written about a passage, in the popover beside it. */
  const [asking, setAsking] = useState<{ passage: ChipState; initial: string; returnFocus?: HTMLElement | null } | null>(null)
  const [previewThreadId, setPreviewThreadId] = useState<string | null>(null)
  const [returnTarget, setReturnTarget] = useState<{ threadId: string; messageId: string; branchId: string; takeawayId?: string } | null>(null)
  const dismissToast = useCallback(() => onToast(null), [onToast])
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [documentsOpen, setDocumentsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const settingsMounted = useOpenedOnce(settingsOpen)
  const documentsMounted = useOpenedOnce(documentsOpen)
  const paletteMounted = useOpenedOnce(paletteOpen)
  usePrefetchLazyParts()
  /** Threads with a reply streaming in, for the sidebar and connectors. */
  const busyIds = useBusyThreads(activeSessionId)
  const composersRef = useRef<Record<string, HTMLTextAreaElement | null>>({})
  const focusNextRef = useRef<string | null>(null)

  const draftFor = useCallback((threadId: string) => drafts[threadId] ?? '', [drafts])
  const attachmentsFor = useCallback((threadId: string) => attachments[threadId] ?? NO_ATTACHMENTS, [attachments])
  const setDraft = onDraftChange

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

  const stopGenerating = useCallback(() => stopChat(activeSessionId), [activeSessionId])

  /** Open the question popover on a passage, optionally with what was typed. */
  const openAsk = useCallback((passage: ChipState, initial = '', returnFocus?: HTMLElement | null) => {
    setAsking({ passage, initial, returnFocus })
    forgetPassage()
  }, [forgetPassage])

  /**
   * Grow the branch and give it the frame to the right of its source.
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
    queueQuestion(activeSessionId, id, question)
    if (options?.focusComposer !== false) focusNextRef.current = id
    setAsking(null)
    clearSelection()
    focus(id)
  }, [activeSessionId, clearSelection, createThread, focus])

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

  const { onExport, onImport, importInput } = useChatTransfer(sessions, importSessions, onToast)

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
      stopThread(activeSessionId, threadId)
      setPreviewThreadId(threadId)
    },
    [activeSessionId, state],
  )

  const discardWithUndo = useCallback((threadId: string) => {
    const removed = descendantIds(state, threadId).flatMap((id) => state.threads[id] ? [state.threads[id]] : [])
    if (removed.length === 0) return
    const focusedBefore = state.activeThreadId
    for (const thread of removed) stopThread(activeSessionId, thread.id)
    discard(threadId)
    onToast({
      id: createId('toast'),
      text: 'Branch discarded',
      actions: [{ label: 'Undo', onClick: () => restoreThreads(removed, focusedBefore) }],
    })
  }, [activeSessionId, discard, onToast, restoreThreads, state])

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
      onSelectMessage,
      onOpenChild,
      onFocus: focus,
      onMerge,
      onDiscard: discardWithUndo,
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
      onSelectMessage,
      onOpenChild,
      focus,
      onMerge,
      discardWithUndo,
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
        const range = chip ?? lastPassage()
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
  }, [activeThread, chip, clearSelection, closeSource, drafts, lastPassage, openAsk, returnToPassage, source, stopGenerating])


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
        <Suspense fallback={null}>
          <SourceLane
            key={`${source.messageId}:${sourceCitation.id}`}
            laneId={SOURCE_LANE_ID}
            citation={sourceCitation}
            leadOffset={frame.leadOffset}
            narrow={narrow}
            onClose={closeSource}
          />
        </Suspense>
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
                onHold={holdPassage}
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
                    <ThreadLane
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

      {documentsMounted ? (
        <Suspense fallback={null}>
          <DocumentsDialog open={documentsOpen} onOpenChange={setDocumentsOpen} />
        </Suspense>
      ) : null}
      <DocumentDropZone onDropped={() => setDocumentsOpen(true)} />

      {settingsMounted ? (
        <Suspense fallback={null}>
          <SettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            onConfigChange={onProviderConfigChange}
            onRestoreDemo={onRestoreDemo}
            onExport={onExport}
            onImport={(file) => void onImport(file)}
          />
        </Suspense>
      ) : null}
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

      {paletteMounted ? (
        <Suspense fallback={null}>
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
        </Suspense>
      ) : null}

      {previewThreadId && state.threads[previewThreadId] ? (
        <Suspense fallback={null}>
          <TakeawayDialog key={previewThreadId} thread={state.threads[previewThreadId]} state={state} onClose={() => setPreviewThreadId(null)} onConfirm={(content) => {
            const thread = state.threads[previewThreadId]
            if (!thread?.parentId || !thread.anchor || !state.threads[thread.parentId]) return
            const parentId = thread.parentId
            stopThread(activeSessionId, parentId)
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
                    stopThread(activeSessionId, parentId)
                    undoTakeaway(parentId, id)
                  },
                },
              ],
            })
            returnToPassage(thread.id, id)
          }} />
        </Suspense>
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

/** Live with a saved OpenRouter key; otherwise replies are the in-page demo. */
function resolveStatus(clientConfig: ClientProviderConfig | null): ProviderStatus {
  return {
    mode: clientConfig?.apiKey ? 'live' : 'mock',
    provider: clientConfig?.apiKey ? 'openrouter' : 'mock',
    model: clientConfig?.model || DEFAULT_OPENROUTER_MODEL,
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
  const status = resolveStatus(clientConfig)

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

  return (
    <>
    {/* Outside the shell, which remounts per chat: replies outlive it. */}
    <ThreadRunners epoch={epoch} />
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
    </>
  )
}
