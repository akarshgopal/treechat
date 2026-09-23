import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Composer } from '@/components/chat/Composer'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { ReplyProgress } from '@/components/chat/ReplyProgress'
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
  /** Space above a branch so its anchor sits level with the source passage. */
  leadOffset?: number
}

/** Each branch off a message is a small, named link beneath its source. */
function BranchRule({ thread, open, onOpen }: { thread: Thread; open: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} aria-label={`${open ? 'Close' : 'Open'} branch: ${threadTitle(thread)}`} aria-pressed={open}
      className={cn('my-0.5 flex min-h-8 max-w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-branch/5 hover:text-branch-bright', open ? 'bg-branch/10 text-branch-bright' : 'text-muted-foreground')}>
      <span className="text-branch" aria-hidden>↳</span>
      <span className="truncate">{threadTitle(thread)}</span>
    </button>
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
  leadOffset = 0,
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

  const transcript = (
    <div className="flex flex-col gap-4">
      {thread.messages.length === 0 && !thread.parentId ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center" data-testid="empty-chat-guide">
          <p className="text-[15px] text-foreground">Ask anything to start.</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Then select any passage in a reply to branch off into a side conversation, without losing your place.
          </p>
          {onShowDemo ? (
            <button type="button" className="branch-starter mt-1 text-sm" onClick={onShowDemo} data-testid="show-demo">
              See how it works
            </button>
          ) : null}
        </div>
      ) : null}
      {thread.messages.length === 0 && emptyLabel ? (
        <p className="text-[13.5px] leading-[1.55] text-muted-foreground">
          {emptyLabel}
        </p>
      ) : null}

      {thread.messages.map((message, index) => {
        const children = childThreadsForMessage(state, thread.id, message.id)
        return (
          <div key={message.id} className="flex flex-col gap-0.5">
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
              onRetry={
                message.role === 'assistant' && message.kind !== 'drop-summary'
                  ? onRetryAssistant
                  : message.role === 'user' ? onRegenerateUser : undefined
              }
              onEdit={message.role === 'user' ? onEditUser : undefined}
            />
            {children.length > 0 ? (
              <div className="flex flex-col items-start" aria-label="Branches from this message">
                {children.map((child) => {
                  const open = child.id === openChildId
                  return <BranchRule key={child.id} thread={child} open={open} onOpen={() => onOpenChild(thread.id, open ? null : child.id)} />
                })}
              </div>
            ) : null}
          </div>
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
    />
  )

  return (
    <div className="flex h-full min-h-0 flex-col" data-lane-id={thread.id}>
      {header ? <div className="shrink-0 border-b border-border px-4 py-2 sm:px-6"><div className="mx-auto max-w-3xl">{header}</div></div> : null}
      <ScrollArea ref={scrollRef} className="min-h-0 flex-1" data-testid="thread-scroll">
        <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6">
          {thread.anchor ? (
            <>
              <div aria-hidden className="lane-lead" style={{ height: leadOffset }} />
              <blockquote
                data-lane-anchor
                data-testid="branch-anchor"
                title={thread.anchor.quote}
                className="mb-4 line-clamp-3 border-l-2 border-branch pl-3 text-[13px] italic leading-snug text-muted-foreground"
              >
                {thread.anchor.quote}
              </blockquote>
            </>
          ) : null}
          {transcript}
        </div>
      </ScrollArea>
      {awayFromLatest && (isLoading || unseen) ? <div className="relative h-0"><button type="button" className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border bg-paper px-3 py-2 text-xs shadow-lg" onClick={() => {
        following.current = true
        const viewport = scrollRef.current?.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')
        if (viewport) viewport.scrollTop = viewport.scrollHeight
      }}>↓ Latest messages</button></div> : null}
      <div className="border-t border-border bg-foreground/[0.025] px-4 py-3 sm:px-6">
        <div className="mx-auto max-w-3xl">
          {error ? <div role="alert" className="mb-3 text-sm text-destructive">{error} <button type="button" className="branch-secondary" onClick={onRetryError}>Try again</button></div> : null}
          {composer}
        </div>
      </div>
    </div>
  )
}
