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
import { ChevronDown, SquarePen } from 'lucide-react'
import { BranchCard } from '@/components/chat/BranchCard'
import { BranchChip } from '@/components/chat/BranchChip'
import { SessionList } from '@/components/chat/SessionList'
import { SettingsDialog } from '@/components/chat/SettingsDialog'
import { MAX_INLINE_DEPTH, ThreadView } from '@/components/chat/ThreadView'
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
import { createId } from '@/lib/ids'
import { fromUIMessages, sameTranscript, toUIMessages } from '@/lib/messages'
import {
  loadProviderConfig,
  providerRequestHeaders,
  type ClientProviderConfig,
} from '@/lib/provider'
import { requestAssistantText } from '@/lib/request-assistant'
import { offsetsInRoot } from '@/lib/selection'
import {
  branchForwardedProps,
  childThreads,
  depthFrom,
  pathTo,
} from '@/lib/tree'
import { isBranchShortcut, truncate } from '@/lib/utils'
import { useTree } from '@/store/tree-store'
import type { ProviderStatus, Thread } from '@/types'

const idleStatus: ProviderStatus = {
  mode: 'mock',
  provider: 'mock',
  model: 'treechat-mock',
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
}

/**
 * Handlers shared by every thread in the tree. Threads render recursively, so
 * drilling these as props would mean re-threading a dozen of them at each level.
 */
type ShellValue = {
  draftFor: (threadId: string) => string
  setDraft: (threadId: string, value: string) => void
  registerComposer: (threadId: string, el: HTMLTextAreaElement | null) => void
  onSelectMessage: (threadId: string, messageId: string) => void
  onOpenChild: (parentId: string, childId: string | null) => void
  onFocus: (threadId: string) => void
  onMerge: (threadId: string) => void
  onDiscard: (threadId: string) => void
  merging: string | null
}

const ShellContext = createContext<ShellValue | null>(null)

function useShell() {
  const value = useContext(ShellContext)
  if (!value) throw new Error('ShellContext missing')
  return value
}

/**
 * One chat engine per rendered thread. Keyed on `rev` by the caller, so an
 * external write (a merged summary) remounts it and it re-reads the transcript
 * rather than overwriting it with its own stale copy.
 */
function ThreadEngine({ threadId, depth }: { threadId: string; depth: number }) {
  const { state, replaceMessages } = useTree()
  const shell = useShell()
  const thread = state.threads[threadId]

  const initialRef = useRef(toUIMessages(thread?.messages ?? []))
  const forwarded = branchForwardedProps(state, threadId)
  const chat = useChat({
    threadId,
    connection: chatConnection,
    initialMessages: initialRef.current,
    forwardedProps: forwarded ?? {},
  })

  const initial = useMemo(() => thread?.messages ?? [], [thread])
  useEffect(() => {
    const next = fromUIMessages(chat.messages)
    if (next.length === 0 && initial.length > 0) return
    if (!sameTranscript(next, initial)) replaceMessages(threadId, next)
  }, [chat.messages, initial, replaceMessages, threadId])

  if (!thread) return null

  const send = () => {
    const text = shell.draftFor(threadId).trim()
    if (!text) return
    shell.setDraft(threadId, '')
    void chat.sendMessage(text)
  }

  return (
    <ThreadView
      thread={thread}
      state={state}
      depth={depth}
      framed={depth === 0}
      draft={shell.draftFor(threadId)}
      onDraftChange={(value) => shell.setDraft(threadId, value)}
      onSend={send}
      onStop={() => chat.stop()}
      isLoading={chat.isLoading}
      onSelectMessage={shell.onSelectMessage}
      onOpenChild={shell.onOpenChild}
      onFocusChild={shell.onFocus}
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
          ? 'This branch is empty. Write below — it stays on this thread, and it already knows everything above it.'
          : undefined
      }
      renderChild={(childId, childDepth) => (
        <NestedBranch threadId={childId} depth={childDepth} />
      )}
    />
  )
}

/** An expanded child: the branch card, with that thread's own engine inside. */
function NestedBranch({ threadId, depth }: { threadId: string; depth: number }) {
  const { state } = useTree()
  const shell = useShell()
  const thread = state.threads[threadId]
  if (!thread) return null
  return (
    <BranchCard
      thread={thread}
      merging={shell.merging === threadId}
      onMerge={() => shell.onMerge(threadId)}
      onDiscard={() => shell.onDiscard(threadId)}
      onFocus={() => shell.onFocus(threadId)}
      onHide={
        thread.parentId
          ? () => shell.onOpenChild(thread.parentId!, null)
          : undefined
      }
    >
      <ThreadEngine key={`${thread.id}:${thread.rev}`} threadId={threadId} depth={depth} />
    </BranchCard>
  )
}

function TreeChatShell({
  epoch,
  status,
  onNewChat,
  onRestoreDemo,
  onProviderConfigChange,
}: {
  epoch: number
  status: ProviderStatus
  onNewChat: () => void
  onRestoreDemo: () => void
  onProviderConfigChange: (config: ClientProviderConfig | null) => void
}) {
  const {
    state,
    sessions,
    activeSessionId,
    activeSession,
    activeThread,
    rootThread,
    createThread,
    expand,
    focus,
    discard,
    appendMessage,
    switchSession,
    renameSession,
    deleteSession,
  } = useTree()

  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [chip, setChip] = useState<ChipState | null>(null)
  const [merging, setMerging] = useState<string | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const composersRef = useRef<Record<string, HTMLTextAreaElement | null>>({})
  const lastRangeRef = useRef<ChipState | null>(null)
  const focusNextRef = useRef<string | null>(null)
  const holdChipRef = useRef(false)

  const draftFor = useCallback((threadId: string) => drafts[threadId] ?? '', [drafts])
  const setDraft = useCallback((threadId: string, value: string) => {
    setDrafts((current) => ({ ...current, [threadId]: value }))
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

  const syncChipFromSelection = useCallback(() => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      if (!holdChipRef.current) setChip(null)
      return
    }
    holdChipRef.current = false
    const node = selection.anchorNode
    const el = (
      node instanceof Element ? node : node?.parentElement
    )?.closest<HTMLElement>('[data-message-id][data-selectable="true"]')
    if (!el) {
      setChip(null)
      return
    }
    const offsets = offsetsInRoot(el)
    if (!offsets) {
      setChip(null)
      return
    }
    const threadId = el.dataset.threadId
    const messageId = el.dataset.messageId
    if (!threadId || !messageId) return
    const rect = selection.getRangeAt(0).getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return
    const next: ChipState = {
      threadId,
      messageId,
      start: offsets.start,
      end: offsets.end,
      quote: offsets.text.trim(),
      top: rect.top,
      left: rect.left + rect.width / 2,
      bottom: rect.bottom,
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

  const branchFromChip = useCallback(
    (range: ChipState) => {
      const id = createThread(range.threadId, {
        messageId: range.messageId,
        start: range.start,
        end: range.end,
        quote: range.quote,
      })
      setChip(null)
      lastRangeRef.current = null
      holdChipRef.current = false
      window.getSelection()?.removeAllRanges()
      focusNextRef.current = id
      const parentDepth = depthFrom(state, state.activeThreadId, range.threadId)
      if (parentDepth >= MAX_INLINE_DEPTH) focus(id)
    },
    [createThread, focus, state],
  )

  const onOpenChild = useCallback(
    (parentId: string, childId: string | null) => {
      expand(parentId, childId)
    },
    [expand],
  )

  const onMerge = useCallback(
    async (threadId: string) => {
      const thread = state.threads[threadId]
      if (!thread || !thread.parentId || !thread.anchor) return
      setMerging(threadId)
      try {
        const quote = thread.anchor.quote
        const transcript = thread.messages
          .map((message) => `${message.role}: ${message.content}`)
          .join('\n')
        const prompt = `Summarize this TreeChat side-thread so it can be folded back into its parent thread. Two to four sentences, no preamble. Quote: "${quote}". Transcript:\n${transcript || '(empty branch)'}`
        let summary = ''
        try {
          const forwarded = branchForwardedProps(state, threadId)
          summary = await requestAssistantText(
            prompt,
            forwarded?.quote ?? quote,
            forwarded?.context ?? '',
          )
        } catch {
          const last = thread.messages.at(-1)?.content ?? 'The tangent was closed.'
          summary = `From the branch on «${quote}»: ${last}`
        }
        appendMessage(thread.parentId, {
          id: createId('merge'),
          role: 'assistant',
          content: summary || 'Summary merged from the branch.',
          createdAt: Date.now(),
          kind: 'drop-summary',
          quote,
        })
        expand(thread.parentId, null)
        if (state.activeThreadId === threadId) focus(thread.parentId)
      } finally {
        setMerging(null)
      }
    },
    [appendMessage, expand, focus, state],
  )

  const shell = useMemo<ShellValue>(
    () => ({
      draftFor,
      setDraft,
      registerComposer,
      onSelectMessage,
      onOpenChild,
      onFocus: focus,
      onMerge: (threadId) => void onMerge(threadId),
      onDiscard: discard,
      merging,
    }),
    [
      draftFor,
      setDraft,
      registerComposer,
      onSelectMessage,
      onOpenChild,
      focus,
      onMerge,
      discard,
      merging,
    ],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isBranchShortcut(event)) {
        event.preventDefault()
        const range = chip ?? lastRangeRef.current
        if (range) branchFromChip(range)
        return
      }
      if (event.key !== 'Escape') return
      if (chip) {
        event.preventDefault()
        setChip(null)
        lastRangeRef.current = null
        holdChipRef.current = false
        window.getSelection()?.removeAllRanges()
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
      focus(parentId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeThread, branchFromChip, chip, drafts, focus])

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

  const rootTitle = rootThread?.messages[0]?.content ?? 'Main thread'
  const path = pathTo(state, activeThread.id)
  const pendingDelete = sessions.find((session) => session.id === pendingDeleteId)
  const onSelectSession = useCallback(
    (sessionId: string) => {
      switchSession(sessionId)
      setLibraryOpen(false)
    },
    [switchSession],
  )
  const onCreateSession = useCallback(() => {
    onNewChat()
    setLibraryOpen(false)
  }, [onNewChat])
  const chipExisting = chip
    ? childThreads(state, chip.threadId).filter(
        (thread) =>
          thread.anchor?.messageId === chip.messageId &&
          thread.anchor.start === chip.start &&
          thread.anchor.end === chip.end,
      ).length
    : 0

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
            aria-label="Switch chat"
            title={activeSession.title}
            data-testid="session-switcher"
            className="flex min-w-0 max-w-[52vw] items-center gap-1 truncate rounded-md px-1.5 py-[3px] text-[12px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground md:hidden"
          >
            <span className="truncate">{activeSession.title}</span>
            <ChevronDown className="size-3.5 shrink-0" />
          </button>
          {path.slice(1).map((thread, index) => {
            const isLast = index === path.length - 2
            return (
              <span key={thread.id} className="flex min-w-0 items-center gap-1.5">
                <span className="shrink-0 text-[12px] text-muted-foreground">/</span>
                <button
                  type="button"
                  onClick={() => focus(thread.id)}
                  title={thread.anchor?.quote}
                  className={`truncate rounded-full px-2 py-[3px] text-[10.5px] font-medium ${
                    isLast
                      ? 'bg-branch/15 text-branch-bright'
                      : 'text-muted-foreground hover:bg-foreground/[0.07]'
                  }`}
                >
                  {truncate(thread.anchor?.quote ?? '', 28)}
                </button>
              </span>
            )
          })}
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <span
            data-testid="provider-mode"
            className="hidden font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground sm:inline"
          >
            {status.mode === 'mock' ? 'Mock stream' : `Live · ${status.provider}`}
          </span>
          {activeThread.parentId ? (
            <button
              type="button"
              onClick={() => focus(activeThread.parentId!)}
              data-testid="back-to-spine"
              className="rounded-md border border-border px-2.5 py-[5px] text-[10.5px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              ← back to thread
            </button>
          ) : null}
          <SettingsDialog
            status={status}
            onConfigChange={onProviderConfigChange}
            onRestoreDemo={onRestoreDemo}
          />
          <button
            type="button"
            onClick={onNewChat}
            aria-label="New chat"
            title="New chat"
            data-testid="new-chat"
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-[5px] text-[10.5px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <SquarePen className="size-3.5" />
            <span className="hidden sm:inline">New chat</span>
          </button>
        </div>
      </header>

      <ShellContext.Provider value={shell}>
        <div className="flex min-h-0 flex-1">
          <aside
            className="hidden min-h-0 w-[252px] shrink-0 flex-col border-r border-border bg-rail md:flex"
            data-testid="chat-sidebar"
          >
            <div className="flex max-h-[42%] min-h-0 shrink-0 flex-col border-b border-border px-3.5 py-3">
              <SessionList
                sessions={sessions}
                activeSessionId={activeSessionId}
                onSelect={onSelectSession}
                onCreate={onCreateSession}
                onRename={renameSession}
                onDelete={setPendingDeleteId}
              />
            </div>
            <TreeRail state={state} rootTitle={rootTitle} onFocus={focus} />
          </aside>
          <div className="min-w-0 flex-1">
            {chip ? (
              <BranchChip
                top={chip.top}
                left={chip.left}
                bottom={chip.bottom}
                existing={chipExisting}
                onBranch={() => branchFromChip(chip)}
                onHold={() => {
                  holdChipRef.current = true
                }}
              />
            ) : null}
            <FramedThread thread={activeThread} epoch={epoch} />
          </div>
        </div>
      </ShellContext.Provider>

      <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
        <DialogContent className="max-w-sm gap-4 sm:rounded-lg" data-testid="session-library">
          <DialogHeader>
            <DialogTitle>Chats</DialogTitle>
            <DialogDescription>Switch, rename, or start a new chat.</DialogDescription>
          </DialogHeader>
          <SessionList
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelect={onSelectSession}
            onCreate={onCreateSession}
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

function FramedThread({ thread, epoch }: { thread: Thread; epoch: number }) {
  return (
    <ThreadEngine
      key={`${thread.id}:${thread.rev}:${epoch}`}
      threadId={thread.id}
      depth={0}
    />
  )
}

function statusFromConfig(config: ClientProviderConfig | null): ProviderStatus | null {
  if (!config) return null
  return {
    mode: 'live',
    provider: 'openrouter',
    model: config.model,
  }
}

export function TreeChatApp() {
  const { restoreDemo, createSession, activeSessionId } = useTree()
  const [epoch, setEpoch] = useState(0)
  const [clientConfig, setClientConfig] = useState<ClientProviderConfig | null>(
    () => loadProviderConfig(),
  )
  const [serverStatus, setServerStatus] = useState<ProviderStatus>(idleStatus)
  const status = statusFromConfig(clientConfig) ?? serverStatus

  const onProviderConfigChange = useCallback((config: ClientProviderConfig | null) => {
    setClientConfig(config)
  }, [])

  const bumpEpoch = useCallback(() => {
    setEpoch((value) => value + 1)
  }, [])

  const onNewChat = useCallback(() => {
    createSession()
  }, [createSession])

  const onRestoreDemo = useCallback(() => {
    restoreDemo()
    bumpEpoch()
  }, [bumpEpoch, restoreDemo])

  useEffect(() => {
    if (clientConfig) return
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
      onProviderConfigChange={onProviderConfigChange}
      onNewChat={onNewChat}
      onRestoreDemo={onRestoreDemo}
    />
  )
}
