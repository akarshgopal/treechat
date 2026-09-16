import type { ReactNode, Ref } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Composer } from '@/components/chat/Composer'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { childThreadsForMessage, subtreeSize } from '@/lib/tree'
import { truncate } from '@/lib/utils'
import type { Thread, TreeState } from '@/types'

/**
 * How many levels of branch may nest inline before we stop nesting and offer
 * the full frame instead. Past this the reading column turns into a staircase.
 * ponytail: fixed cap; make it responsive to column width if it ever bites.
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
  onToggleChild: (parentId: string, childId: string) => void
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
}

/** Hairline rule with a pill — opens the branch anchored above it. */
function BranchRule({
  thread,
  state,
  open,
  ordinal,
  siblings,
  onToggle,
}: {
  thread: Thread
  state: TreeState
  open: boolean
  ordinal: number
  siblings: number
  onToggle: () => void
}) {
  const count = subtreeSize(state, thread.id)
  const quote = thread.anchor?.quote ?? ''
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${open ? 'Hide' : 'Open'} branch on “${quote}” with ${count} ${
        count === 1 ? 'reply' : 'replies'
      }`}
      className="group relative flex h-[38px] w-full cursor-pointer select-none items-center"
    >
      <span
        className={`absolute inset-x-0 top-[18.5px] h-px transition-colors ${
          open ? 'bg-branch/35' : 'bg-border group-hover:bg-branch/30'
        }`}
      />
      <span
        className={`relative mx-auto flex items-center gap-2 rounded-full border bg-paper py-[5px] pl-2.5 pr-3 shadow-[0_4px_14px_-6px_rgba(0,0,0,0.7)] transition-transform group-hover:scale-[1.03] ${
          open ? 'border-branch/40' : 'border-border'
        }`}
      >
        <span className="text-[13px] leading-none text-branch">
          {open ? '⌄' : '↳'}
        </span>
        <span className="eyebrow text-muted-foreground">
          {open ? 'hide branch' : truncate(quote, 34)}
        </span>
        {siblings > 1 ? (
          <span className="eyebrow text-branch-bright">
            {ordinal}/{siblings}
          </span>
        ) : null}
        {count > 0 ? (
          <span className="eyebrow rounded-full bg-branch/15 px-1.5 py-px text-branch-bright">
            {count}
          </span>
        ) : null}
      </span>
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
  onToggleChild,
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
}: ThreadViewProps) {
  const expandedChildId = state.expanded[thread.id] ?? null

  const transcript = (
    <div className="flex flex-col gap-5">
      {lede}
      {thread.messages.length === 0 && emptyLabel ? (
        <p className="text-[13.5px] leading-[1.6] text-muted-foreground">
          {emptyLabel}
        </p>
      ) : null}

      {thread.messages.map((message) => {
        const children = childThreadsForMessage(state, thread.id, message.id)
        return (
          <div key={message.id} className="flex flex-col gap-1">
            <MessageBubble
              message={message}
              childThreads={children}
              openChildId={expandedChildId}
              labels={depth === 0}
              compact={depth > 0}
              onSelectMessage={(messageId) =>
                onSelectMessage(thread.id, messageId)
              }
              onOpenBranch={(childId) => onToggleChild(thread.id, childId)}
            />
            {children.map((child) => {
              const isOpen = expandedChildId === child.id
              const sameSpan = children.filter(
                (other) =>
                  other.anchor?.start === child.anchor?.start &&
                  other.anchor?.end === child.anchor?.end,
              )
              return (
                <div key={child.id}>
                  <BranchRule
                    thread={child}
                    state={state}
                    open={isOpen}
                    ordinal={sameSpan.indexOf(child) + 1}
                    siblings={sameSpan.length}
                    onToggle={() => onToggleChild(thread.id, child.id)}
                  />
                  {isOpen ? (
                    depth >= MAX_INLINE_DEPTH ? (
                      <TooDeep
                        thread={child}
                        onFocus={() => onFocusChild(child.id)}
                      />
                    ) : (
                      renderChild(child.id, depth + 1)
                    )
                  ) : null}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )

  const composer = (
    <Composer
      ref={composerRef}
      value={draft}
      onChange={onDraftChange}
      onSend={onSend}
      onStop={onStop}
      isLoading={isLoading}
      onFocus={onComposerFocus}
      placeholder={placeholder}
      accent={accentComposer}
      trailing={composerTrailing}
    />
  )

  if (!framed) {
    return (
      <div className="flex flex-col gap-[13px]">
        {transcript}
        {composer}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-5 py-6 sm:px-8">
          {transcript}
        </div>
      </ScrollArea>
      <div className="border-t border-border bg-foreground/[0.03] px-5 py-[13px] sm:px-8">
        <div className="mx-auto max-w-3xl">{composer}</div>
      </div>
    </div>
  )
}

/** Past the inline nesting cap a branch gets the full frame instead. */
function TooDeep({ thread, onFocus }: { thread: Thread; onFocus: () => void }) {
  return (
    <div className="relative pb-1 pl-[26px] pt-0.5">
      <span className="branch-spine absolute bottom-2.5 left-[5px] top-1.5 w-[2px] rounded-sm" />
      <div className="flex items-center justify-between gap-3 rounded-[9px] border border-branch/25 bg-branch/[0.07] px-[15px] py-3">
        <span className="min-w-0 text-[13px] italic text-muted-foreground">
          “{truncate(thread.anchor?.quote ?? '', 48)}”
        </span>
        <button
          type="button"
          onClick={onFocus}
          className="shrink-0 rounded-md border border-branch/30 bg-branch/[0.13] px-2.5 py-[5px] text-[10.5px] font-medium text-branch-bright transition-colors hover:bg-branch/25"
        >
          Open as chat ⤢
        </button>
      </div>
    </div>
  )
}
