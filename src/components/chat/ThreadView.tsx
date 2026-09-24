import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Composer, type ComposerAttach, type ComposerWebSearch } from '@/components/chat/Composer'
import { MarginBranches } from '@/components/chat/MarginBranches'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { ReplyProgress } from '@/components/chat/ReplyProgress'
import { SummaryDivider } from '@/components/chat/SummaryDivider'
import { childThreadsForMessage, threadTitle } from '@/lib/tree'
import type { Thread, TreeState } from '@/types'

type ThreadViewProps = {
  thread: Thread
  state: TreeState
  draft: string
  onDraftChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  isLoading: boolean
  onSelectMessage: (threadId: string, messageId: string) => void
  /** Open a branch in the lane to the right, or close it with `null`. */
  onOpenChild: (parentId: string, childId: string | null) => void
  onFocusChild: (threadId: string) => void
  /** The child of this thread showing in the next lane, if any. */
  openChildId: string | null
  composerRef?: Ref<HTMLTextAreaElement>
  onComposerFocus?: () => void
  placeholder: string
  accentComposer?: boolean
  composerTrailing?: ReactNode
  /** Files for the next message in this thread. */
  composerAttach?: ComposerAttach
  composerNotice?: ReactNode
  /** Whether replies in this thread search the web. */
  composerWebSearch?: ComposerWebSearch
  emptyLabel?: string
  onRetryAssistant?: (messageId: string) => void
  onRegenerateUser?: (messageId: string) => void
  /** Resolves false when the edit was not applied, so the editor stays open. */
  onEditUser?: (messageId: string, content: string) => Promise<boolean>
  onAskMessage?: (threadId: string, messageId: string) => void
  header?: ReactNode
  scrollPositions?: Map<string, number>
  scrollKey?: string
  error?: string
  onRetryError?: () => void
  /** Offered in an empty chat: load the walkthrough. */
  onShowDemo?: () => void
  /** A line under the empty chat's prompt, e.g. that replies are demo text. */
  blankNote?: ReactNode
  /** Space above a branch so its anchor sits level with the source passage. */
  leadOffset?: number
  /** The citation in this thread whose source lane is open beside it. */
  openCitation?: { messageId: string; citationId: string } | null
  onOpenCitation?: (threadId: string, messageId: string, citationId: string) => void
}

/** A message and, in its left margin, the branches growing from it. */
function MessageRow({ branches, openChildId, onOpenChild, children }: {
  branches: Thread[]
  openChildId: string | null
  onOpenChild: (childId: string | null) => void
  children: ReactNode
}) {
  return (
    <div className="relative flex flex-col gap-0.5">
      {children}
      {branches.length > 0 ? <MarginBranches branches={branches} openId={openChildId} onOpen={onOpenChild} /> : null}
    </div>
  )
}

export function ThreadView({
  thread,
  state,
  draft,
  onDraftChange,
  onSend,
  onStop,
  isLoading,
  onSelectMessage,
  onOpenChild,
  onFocusChild,
  openChildId,
  composerRef,
  onComposerFocus,
  placeholder,
  accentComposer,
  composerTrailing,
  composerAttach,
  composerNotice,
  composerWebSearch,
  emptyLabel,
  onRetryAssistant,
  onRegenerateUser,
  onEditUser,
  onAskMessage,
  header,
  scrollPositions,
  scrollKey,
  error,
  onRetryError,
  onShowDemo,
  blankNote,
  leadOffset = 0,
  openCitation = null,
  onOpenCitation,
}: ThreadViewProps) {
  const lastMessage = thread.messages.at(-1)
  const waitingForReply = isLoading && (lastMessage?.role !== 'assistant' || !lastMessage.content.trim())
  const scrollRef = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const [awayFromLatest, setAwayFromLatest] = useState(false)
  // Only offer the jump when there is something new below — not merely
  // because the reader scrolled up to reread.
  const [unseen, setUnseen] = useState(false)
  const seenMessages = useRef(thread.messages)

  useLayoutEffect(() => {
    const viewport = scrollRef.current?.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')
    if (!viewport || !scrollKey) return
    viewport.scrollTop = scrollPositions?.get(scrollKey) ?? 0
    const remember = () => {
      scrollPositions?.set(scrollKey, viewport.scrollTop)
      following.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80
      setAwayFromLatest(!following.current)
      if (following.current) setUnseen(false)
    }
    remember()
    viewport.addEventListener('scroll', remember, { passive: true })
    return () => {
      scrollPositions?.set(scrollKey, viewport.scrollTop)
      viewport.removeEventListener('scroll', remember)
    }
  }, [scrollKey, scrollPositions])

  useEffect(() => {
    if (seenMessages.current === thread.messages) return
    seenMessages.current = thread.messages
    if (!following.current) setUnseen(true)
  }, [thread.messages])

  useEffect(() => {
    if (!isLoading || !following.current) return
    const viewport = scrollRef.current?.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [thread.messages, isLoading])

  // A new chat: the prompt and the composer sit together in the middle.
  const blank = thread.messages.length === 0 && !thread.parentId
  const guide = blank ? (
    <div className="mb-6 flex flex-col items-center gap-2 text-center" data-testid="empty-chat-guide">
      <p className="text-[15px] font-medium text-foreground">Ask anything to start.</p>
      <p className="max-w-sm text-[13px] text-muted-foreground">
        Then select any passage in a reply to branch off, without losing your place.
      </p>
      {blankNote ? <p className="max-w-sm text-xs text-muted-foreground">{blankNote}</p> : null}
      {onShowDemo ? (
        <button type="button" className="btn mt-1" onClick={onShowDemo} data-testid="show-demo">
          See how it works
        </button>
      ) : null}
    </div>
  ) : null

  const transcript = (
    <div className="flex flex-col gap-8">
      {thread.messages.length === 0 && emptyLabel ? (
        <p className="text-sm leading-[1.55] text-muted-foreground">
          {emptyLabel}
        </p>
      ) : null}

      {thread.messages.map((message, index) => {
        const children = childThreadsForMessage(state, thread.id, message.id)
        return (
          <MessageRow key={message.id} branches={children} openChildId={openChildId} onOpenChild={(childId) => onOpenChild(thread.id, childId)}>
            {thread.summary && thread.messages[index - 1]?.id === thread.summary.throughMessageId ? <SummaryDivider summary={thread.summary} /> : null}
            <MessageBubble
              message={message}
              threadId={thread.id}
              childThreads={children}
              openChildId={openChildId}
              labels={false}
              compact={Boolean(thread.parentId)}
              onSelectMessage={(messageId) =>
                onSelectMessage(thread.id, messageId)
              }
              onOpenBranch={(childId) => onOpenChild(thread.id, childId)}
              onAsk={onAskMessage ? () => onAskMessage(thread.id, message.id) : undefined}
              sourceThread={message.sourceThreadId ? state.threads[message.sourceThreadId] : undefined}
              onViewSource={onFocusChild}
              unanswered={message.role === 'user' && index === thread.messages.length - 1 && !isLoading}
              latest={index >= thread.messages.length - 2}
              onRetry={
                message.role === 'assistant' && message.kind !== 'drop-summary'
                  ? onRetryAssistant
                  : message.role === 'user' ? onRegenerateUser : undefined
              }
              onEdit={message.role === 'user' ? onEditUser : undefined}
              openCitationId={openCitation?.messageId === message.id ? openCitation.citationId : null}
              onOpenCitation={onOpenCitation ? (messageId, citationId) => onOpenCitation(thread.id, messageId, citationId) : undefined}
            />
          </MessageRow>
        )
      })}
      {waitingForReply ? <ReplyProgress /> : null}
    </div>
  )

  const composer = (
    <Composer
      ref={composerRef}
      value={draft}
      onChange={onDraftChange}
      onSend={() => { following.current = true; onSend() }}
      destination={threadTitle(thread)}
      onStop={onStop}
      isLoading={isLoading}
      onFocus={onComposerFocus}
      placeholder={placeholder}
      testId="thread-composer"
      accent={accentComposer}
      trailing={composerTrailing}
      attach={composerAttach}
      notice={composerNotice}
      webSearch={composerWebSearch}
    />
  )

  return (
    <div className="flex h-full min-h-0 flex-col" data-lane-id={thread.id}>
      {header}
      <ScrollArea ref={scrollRef} className={cn('min-h-0', blank ? 'hidden' : 'flex-1')} data-testid="thread-scroll">
        <div className="mx-auto w-full max-w-3xl px-7 pb-8 pt-6">
          {thread.anchor ? (
            <>
              <div aria-hidden className="lane-lead" style={{ height: leadOffset }} />
              <blockquote
                data-lane-anchor
                data-testid="branch-anchor"
                title={thread.anchor.quote}
                className="mb-5 line-clamp-3 border-l-2 border-branch pl-3 text-[13px] italic leading-snug text-muted-foreground"
              >
                {thread.anchor.quote}
              </blockquote>
            </>
          ) : null}
          {transcript}
        </div>
      </ScrollArea>
      {awayFromLatest && (isLoading || unseen) ? <div className="relative h-0"><button type="button" className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border bg-paper px-3 py-1.5 text-xs shadow-lg" onClick={() => {
        following.current = true
        const viewport = scrollRef.current?.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')
        if (viewport) viewport.scrollTop = viewport.scrollHeight
      }}>↓ Latest messages</button></div> : null}
      {/* The same slot holds the composer in both layouts, so it keeps focus
          when the first message moves it from the middle to the bottom. */}
      <div className={cn('px-4 pb-4', blank ? 'flex flex-1 flex-col justify-center pb-[14vh]' : 'pt-1')}>
        <div className="mx-auto w-full max-w-3xl">
          {guide}
          {error ? <div role="alert" className="mb-2 flex items-center gap-2 text-[13px] text-destructive">{error} <button type="button" className="btn" onClick={onRetryError}>Try again</button></div> : null}
          {composer}
        </div>
      </div>
    </div>
  )
}
