import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useChat } from '@tanstack/ai-react'
import { GitBranch, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { BranchChip } from '@/components/chat/BranchChip'
import { ConversationView } from '@/components/chat/ConversationView'
import { SpineView } from '@/components/chat/SpineView'
import { chatConnection } from '@/lib/chat-connection'
import { createId } from '@/lib/ids'
import { fromUIMessages, sameTranscript, toUIMessages } from '@/lib/messages'
import { requestAssistantText } from '@/lib/request-assistant'
import { offsetsInRoot } from '@/lib/selection'
import { isModKey } from '@/lib/utils'
import { useTree } from '@/store/tree-store'
import type { ChatMessage, ProviderStatus } from '@/types'

const idleStatus: ProviderStatus = {
  mode: 'mock',
  provider: 'mock',
  model: 'treechat-mock',
}

type ChipState = {
  messageId: string
  start: number
  end: number
  quote: string
  top: number
  left: number
}

function SpineEngine({
  initial,
  onMessages,
  children,
}: {
  initial: ChatMessage[]
  onMessages: (messages: ChatMessage[]) => void
  children: (chat: ReturnType<typeof useChat>) => ReactNode
}) {
  const initialRef = useRef(toUIMessages(initial))
  const chat = useChat({
    threadId: 'spine',
    connection: chatConnection,
    initialMessages: initialRef.current,
  })

  useEffect(() => {
    const next = fromUIMessages(chat.messages)
    if (!sameTranscript(next, initial) && next.length > 0) {
      onMessages(next)
    }
  }, [chat.messages, initial, onMessages])

  return <>{children(chat)}</>
}

function BranchEngine({
  branchId,
  quote,
  initial,
  onMessages,
  children,
}: {
  branchId: string
  quote: string
  initial: ChatMessage[]
  onMessages: (messages: ChatMessage[]) => void
  children: (chat: ReturnType<typeof useChat>) => ReactNode
}) {
  const initialRef = useRef(toUIMessages(initial))
  const chat = useChat({
    threadId: branchId,
    connection: chatConnection,
    initialMessages: initialRef.current,
    forwardedProps: { quote },
  })

  useEffect(() => {
    const next = fromUIMessages(chat.messages)
    if (!sameTranscript(next, initial)) {
      onMessages(next)
    }
  }, [chat.messages, initial, onMessages])

  return <>{children(chat)}</>
}

function TreeChatShell({
  epoch,
  status,
  onReset,
}: {
  epoch: number
  status: ProviderStatus
  onReset: () => void
}) {
  const tree = useTree()
  const {
    state,
    activeBranch,
    createBranch,
    openBranch,
    discardBranch,
    openConversation,
    backToSpine,
    replaceSpine,
    replaceBranchMessages,
  } = tree

  const [spineDraft, setSpineDraft] = useState('')
  const [branchDraft, setBranchDraft] = useState('')
  const [chip, setChip] = useState<ChipState | null>(null)
  const [dropping, setDropping] = useState(false)
  const spineComposerRef = useRef<HTMLTextAreaElement>(null)
  const branchComposerRef = useRef<HTMLTextAreaElement>(null)
  const lastRangeRef = useRef<ChipState | null>(null)

  const openInline =
    state.view.kind === 'spine'
      ? (state.branches.find((branch) => branch.id === state.openBranchId) ?? null)
      : null

  const captureSelection = useCallback(
    (messageId: string) => {
      const root = document.querySelector<HTMLElement>(
        `[data-message-id="${messageId}"][data-selectable="true"]`,
      )
      if (!root) return
      const offsets = offsetsInRoot(root)
      if (!offsets) {
        setChip(null)
        return
      }
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) return
      const rect = selection.getRangeAt(0).getBoundingClientRect()
      const next: ChipState = {
        messageId,
        start: offsets.start,
        end: offsets.end,
        quote: offsets.text.trim(),
        top: rect.top,
        left: rect.left + rect.width / 2,
      }
      lastRangeRef.current = next
      setChip(next)
    },
    [],
  )

  const branchFromChip = useCallback(
    (range: ChipState) => {
      createBranch(range.messageId, range.start, range.end, range.quote)
      setChip(null)
      window.getSelection()?.removeAllRanges()
      setTimeout(() => branchComposerRef.current?.focus(), 40)
    },
    [createBranch],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isModKey(event) && event.shiftKey && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        const range = lastRangeRef.current
        if (range) branchFromChip(range)
        return
      }
      if (event.key === 'Escape') {
        if (chip) {
          setChip(null)
          return
        }
        if (state.view.kind === 'conversation') {
          const active = document.activeElement
          const composer = branchComposerRef.current
          const focused = Boolean(composer && composer === active)
          const dirty = branchDraft.trim().length > 0
          if (focused && dirty) {
            composer?.blur()
            event.preventDefault()
            return
          }
          event.preventDefault()
          backToSpine()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [backToSpine, branchDraft, branchFromChip, chip, state.view.kind])

  useEffect(() => {
    const clear = () => setChip(null)
    window.addEventListener('scroll', clear, true)
    return () => window.removeEventListener('scroll', clear, true)
  }, [])

  const spineSetMessages = useRef<ReturnType<typeof useChat>['setMessages'] | null>(
    null,
  )
  const spineMessages = useRef<ReturnType<typeof useChat>['messages']>([])

  const handleDrop = useCallback(async () => {
    if (!activeBranch) return
    setDropping(true)
    try {
      const transcript = activeBranch.messages
        .map((message) => `${message.role}: ${message.content}`)
        .join('\n')
      const prompt = `Summarize this TreeChat tangent so it can be dropped into the main spine. Two to four sentences, no preamble. Quote: "${activeBranch.quote}". Transcript:\n${transcript || '(empty branch)'}`
      let summary = ''
      try {
        summary = await requestAssistantText(prompt, activeBranch.quote)
      } catch {
        const last = activeBranch.messages.at(-1)?.content ?? 'The tangent was closed.'
        summary = `From the branch on «${activeBranch.quote}»: ${last}`
      }
      const dropId = createId('drop')
      spineSetMessages.current?.([
        ...spineMessages.current,
        {
          id: dropId,
          role: 'assistant',
          parts: [{ type: 'text', content: summary || 'Summary dropped from the branch.' }],
          createdAt: new Date(),
          metadata: { kind: 'drop-summary', quote: activeBranch.quote },
        },
      ])
      if (state.view.kind === 'conversation') backToSpine()
      tree.closeBranch()
    } finally {
      setDropping(false)
    }
  }, [activeBranch, backToSpine, state.view.kind, tree])

  const banner =
    openInline && state.view.kind === 'spine' ? (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/20 bg-accent/50 px-3 py-1.5 text-sm">
        <span>
          Posting to main
          <span className="text-muted-foreground"> · </span>
          <button
            type="button"
            className="font-medium text-primary underline-offset-2 hover:underline"
            onClick={() => branchComposerRef.current?.focus()}
          >
            switch to branch
          </button>
        </span>
      </div>
    ) : null

  return (
    <div className="flex h-svh flex-col bg-background" data-view={state.view.kind}>
      <header className="flex items-center justify-between gap-3 bg-header px-4 py-3 text-header-foreground">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary-foreground/10">
            <GitBranch className="size-4" />
          </div>
          <div>
            <p className="font-display text-lg font-semibold leading-none tracking-tight">
              TreeChat
            </p>
            <p className="mt-1 text-xs text-header-foreground/70">
              Select a passage to branch · Ctrl/Cmd+Shift+B
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="border-header-foreground/20 bg-header-foreground/5 text-header-foreground"
          >
            {status.mode === 'mock' ? 'Mock stream' : `Live · ${status.provider}`}
          </Badge>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="text-header-foreground hover:bg-header-foreground/10 hover:text-header-foreground"
                onClick={onReset}
                aria-label="Reset demo"
              >
                <RotateCcw className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reset seeded conversation</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <SpineEngine
        key={`spine-${epoch}`}
        initial={state.spine}
        onMessages={replaceSpine}
      >
        {(spineChat) => {
          spineSetMessages.current = spineChat.setMessages
          spineMessages.current = spineChat.messages
          const sendSpine = () => {
            const text = spineDraft.trim()
            if (!text) return
            setSpineDraft('')
            void spineChat.sendMessage(text)
          }

          const conversationBranch =
            state.view.kind === 'conversation' ? activeBranch : openInline

          const body = (branchChat: ReturnType<typeof useChat> | null) => {
            const sendBranch = () => {
              const text = branchDraft.trim()
              if (!text || !branchChat) return
              setBranchDraft('')
              void branchChat.sendMessage(text)
            }

            if (state.view.kind === 'conversation' && activeBranch) {
              return (
                <ConversationView
                  branch={activeBranch}
                  draft={branchDraft}
                  onDraftChange={setBranchDraft}
                  onSend={sendBranch}
                  onStop={() => branchChat?.stop()}
                  isLoading={Boolean(branchChat?.isLoading)}
                  dropping={dropping}
                  onDrop={() => void handleDrop()}
                  onDiscard={() => discardBranch(activeBranch.id)}
                  onBack={backToSpine}
                  composerRef={branchComposerRef}
                />
              )
            }

            return (
              <SpineView
                messages={
                  fromUIMessages(spineChat.messages).length > 0
                    ? fromUIMessages(spineChat.messages)
                    : state.spine
                }
                branches={state.branches}
                openBranch={openInline}
                onSelectMessage={captureSelection}
                onOpenBranch={(id) => {
                  if (state.openBranchId === id) {
                    tree.closeBranch()
                  } else {
                    openBranch(id)
                  }
                }}
                spineDraft={spineDraft}
                onSpineDraftChange={setSpineDraft}
                onSpineSend={sendSpine}
                onSpineStop={() => spineChat.stop()}
                spineLoading={spineChat.isLoading}
                spineComposerRef={spineComposerRef}
                onSpineFocus={() => undefined}
                banner={banner}
                branchDraft={branchDraft}
                onBranchDraftChange={setBranchDraft}
                onBranchSend={sendBranch}
                onBranchStop={() => branchChat?.stop()}
                branchLoading={Boolean(branchChat?.isLoading)}
                dropping={dropping}
                onDrop={() => void handleDrop()}
                onDiscard={() => openInline && discardBranch(openInline.id)}
                onOpenConversation={() =>
                  openInline && openConversation(openInline.id)
                }
                branchComposerRef={branchComposerRef}
                onBranchFocus={() => undefined}
              />
            )
          }

          if (!conversationBranch) {
            return (
              <div className="min-h-0 flex-1">
                {chip ? (
                  <BranchChip
                    top={chip.top}
                    left={chip.left}
                    onBranch={() => branchFromChip(chip)}
                  />
                ) : null}
                {body(null)}
              </div>
            )
          }

          return (
            <BranchEngine
              key={`${conversationBranch.id}-${epoch}`}
              branchId={conversationBranch.id}
              quote={conversationBranch.quote}
              initial={conversationBranch.messages}
              onMessages={(messages) =>
                replaceBranchMessages(conversationBranch.id, messages)
              }
            >
              {(branchChat) => (
                <div className="min-h-0 flex-1">
                  {chip && state.view.kind === 'spine' ? (
                    <BranchChip
                      top={chip.top}
                      left={chip.left}
                      onBranch={() => branchFromChip(chip)}
                    />
                  ) : null}
                  {body(branchChat)}
                </div>
              )}
            </BranchEngine>
          )
        }}
      </SpineEngine>
    </div>
  )
}

export function TreeChatApp() {
  const tree = useTree()
  const [epoch, setEpoch] = useState(0)
  const [status, setStatus] = useState<ProviderStatus>(idleStatus)

  useEffect(() => {
    let cancelled = false
    fetch('/api/status')
      .then((response) => response.json())
      .then((data: ProviderStatus) => {
        if (!cancelled) setStatus(data)
      })
      .catch(() => {
        if (!cancelled) setStatus(idleStatus)
      })
    return () => {
      cancelled = true
    }
  }, [epoch])

  const onReset = () => {
    tree.resetDemo()
    setEpoch((value) => value + 1)
  }

  return (
    <TreeChatShell
      key={epoch}
      epoch={epoch}
      status={status}
      onReset={onReset}
    />
  )
}
