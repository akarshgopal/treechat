import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Composer } from '@/components/chat/Composer'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { ReplyProgress } from '@/components/chat/ReplyProgress'
import {
  childThreadsForMessage,
  groupThreadsBySpan,
  threadTitle,
} from '@/lib/tree'
import { truncate } from '@/lib/utils'
import type { Thread, TreeState } from '@/types'

/**
 * How many levels of branch may nest inline before we stop nesting and offer
 * the full frame instead. Past this the reading column turns into a staircase.
 */
export const MAX_INLINE_DEPTH = 2

type ThreadViewProps = {
  thread: Thread
  state: TreeState
  /** Nesting level below the framed thread. 0 = the framed thread itself. */
  depth: number
  draft: string
  onDraftChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  isLoading: boolean
  onSelectMessage: (threadId: string, messageId: string) => void
  onOpenChild: (parentId: string, childId: string | null) => void
  onFocusChild: (threadId: string) => void
  /** Renders a nested thread's own engine + view. */
  renderChild: (childId: string, depth: number) => ReactNode
  composerRef?: Ref<HTMLTextAreaElement>
  onComposerFocus?: () => void
  placeholder: string
  accentComposer?: boolean
  composerTrailing?: ReactNode
  emptyLabel?: string
  /** This thread holds the full frame: scrolls, with the composer pinned. */
  framed?: boolean
  /** Rendered above the transcript in the framed view. */
  lede?: ReactNode
  onRetryAssistant?: (messageId: string) => void
  onRegenerateUser?: (messageId: string) => void
  /** Resolves false when the edit was not applied, so the editor stays open. */
  onEditUser?: (messageId: string, content: string) => Promise<boolean>
  onAskMessage?: (threadId: string, messageId: string) => void
  renderQuestion?: (threadId: string, messageId: string) => ReactNode
  header?: ReactNode
  scrollPositions?: Map<string, number>
  scrollKey?: string
  error?: string
  onRetryError?: () => void
  /** Offered in an empty chat: load the walkthrough. */
  onShowDemo?: () => void
}

/** A closed exploration is a small, named link beneath its source. */
function BranchRule({ thread, onOpen }: { thread: Thread; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} aria-label={`Open branch: ${threadTitle(thread)}`}
      className="my-1 flex min-h-9 max-w-full items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground hover:bg-branch/5 hover:text-branch-bright">
      <span className="text-branch" aria-hidden>↳</span>
      <span className="truncate">{threadTitle(thread)}</span>
    </button>
  )
}

export function ThreadView({
  thread,
  state,
  depth,
  draft,
  onDraftChange,
  onSend,
  onStop,
  isLoading,
  onSelectMessage,
  onOpenChild,
  onFocusChild,
  renderChild,
  composerRef,
  onComposerFocus,
  placeholder,
  accentComposer,
  composerTrailing,
  emptyLabel,
  framed,
  lede,
  onRetryAssistant,
  onRegenerateUser,
  onEditUser,
  onAskMessage,
  renderQuestion,
  header,
  scrollPositions,
  scrollKey,
  error,
  onRetryError,
  onShowDemo,
}: ThreadViewProps) {
  const expandedChildId = state.expanded[thread.id] ?? null
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
      {lede}
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
        const groups = groupThreadsBySpan(children)
        const question = renderQuestion?.(thread.id, message.id)
        return (
          <div key={message.id} className="flex flex-col gap-0.5">
            <MessageBubble
              message={message}
              threadId={thread.id}
              childThreads={children}
              openChildId={expandedChildId}
              labels={false}
              compact={depth > 0}
              onSelectMessage={(messageId) =>
                onSelectMessage(thread.id, messageId)
              }
              onOpenBranch={(childId) => onOpenChild(thread.id, childId)}
              onAsk={onAskMessage ? () => onAskMessage(thread.id, message.id) : undefined}
              sourceThread={message.sourceThreadId ? state.threads[message.sourceThreadId] : undefined}
              onViewSource={onFocusChild}
              hideActions={Boolean(question)}
              unanswered={message.role === 'user' && index === thread.messages.length - 1 && !isLoading}
              onRetry={
                message.role === 'assistant' && message.kind !== 'drop-summary'
                  ? onRetryAssistant
                  : message.role === 'user' ? onRegenerateUser : undefined
              }
              onEdit={message.role === 'user' ? onEditUser : undefined}
            />
            {question}
            {groups.map((group) => {
              const ids = group.map((child) => child.id)
              const openInGroup = ids.includes(expandedChildId ?? '')
                ? expandedChildId
                : null
              const openChild = group.find((child) => child.id === openInGroup)
              return (
                <div key={ids.join(':')}>
                  {group.length === 1 && !openChild ? <BranchRule thread={group[0]} onOpen={() => onOpenChild(thread.id, group[0].id)} /> : null}
                  {group.length > 1 ? <div className="flex flex-wrap gap-1" aria-label="Choose a branch">{group.map((child) => <button key={child.id} type="button" className={`branch-secondary max-w-full truncate ${child.id === openInGroup ? 'text-branch-bright' : 'text-muted-foreground'}`} aria-pressed={child.id === openInGroup} onClick={() => onOpenChild(thread.id, child.id)}>{threadTitle(child)}</button>)}</div> : null}
                  {openChild ? (
                    depth >= MAX_INLINE_DEPTH ? (
                      <TooDeep
                        thread={openChild}
                        onFocus={() => onFocusChild(openChild.id)}
                      />
                    ) : (
                      renderChild(openChild.id, depth + 1)
                    )
                  ) : null}
                </div>
              )
            })}
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
      showDestination={Boolean(framed && expandedChildId)}
      onStop={onStop}
      isLoading={isLoading}
      onFocus={onComposerFocus}
      placeholder={placeholder}
      testId={framed ? 'thread-composer' : undefined}
      accent={accentComposer}
      trailing={composerTrailing}
    />
  )

  if (!framed) {
    return (
      <div className="flex flex-col gap-3">
        {transcript}
        {error ? <div role="alert" className="text-sm text-destructive">{error} <button className="branch-secondary" onClick={onRetryError}>Try again</button></div> : null}
        {composer}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header ? <div className="shrink-0 border-b border-border px-5 py-2 sm:px-8"><div className="mx-auto max-w-3xl">{header}</div></div> : null}
      <ScrollArea ref={scrollRef} className="min-h-0 flex-1" data-testid="thread-scroll">
        <div className="mx-auto w-full max-w-3xl px-5 py-5 sm:px-8">
          {transcript}
        </div>
      </ScrollArea>
      {awayFromLatest && (isLoading || unseen) ? <div className="relative h-0"><button type="button" className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border bg-paper px-3 py-2 text-xs shadow-lg" onClick={() => {
        following.current = true
        const viewport = scrollRef.current?.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')
        if (viewport) viewport.scrollTop = viewport.scrollHeight
      }}>↓ Latest messages</button></div> : null}
      <div className="border-t border-border bg-foreground/[0.025] px-5 py-3 sm:px-8">
        <div className="mx-auto max-w-3xl">
          {error ? <div role="alert" className="mb-3 text-sm text-destructive">{error} <button type="button" className="branch-secondary" onClick={onRetryError}>Try again</button></div> : null}
          {composer}
        </div>
      </div>
    </div>
  )
}

/** Past the inline nesting cap a branch gets the full frame instead. */
function TooDeep({ thread, onFocus }: { thread: Thread; onFocus: () => void }) {
  return (
    <div className="relative pb-0.5 pl-[22px] pt-0.5">
      <span className="branch-spine absolute bottom-2 left-[4px] top-1 w-[2px] rounded-full" />
      <div className="flex items-center justify-between gap-3 rounded-[9px] border border-branch/20 bg-branch/[0.05] px-3.5 py-2.5">
        <span className="min-w-0 text-[13px] italic text-muted-foreground">
          “{truncate(thread.anchor?.quote ?? '', 48)}”
        </span>
        <button
          type="button"
          onClick={onFocus}
          className="shrink-0 rounded-md border border-branch/30 bg-branch/[0.13] px-2.5 py-[5px] text-[10.5px] font-medium text-branch-bright transition-colors hover:bg-branch/25"
        >
          Expand branch ⤢
        </button>
      </div>
    </div>
  )
}
