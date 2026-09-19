import type { ReactNode, Ref } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Composer } from '@/components/chat/Composer'
import { MessageBubble } from '@/components/chat/MessageBubble'
import {
  childThreadsForMessage,
  cycleOpenId,
  groupThreadsBySpan,
  subtreeSize,
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
}

/** Hairline rule with a pill — opens / cycles the branch(es) anchored above it. */
function BranchRule({
  threads,
  state,
  openId,
  onCycle,
}: {
  threads: Thread[]
  state: TreeState
  openId: string | null
  onCycle: () => void
}) {
  const primary = threads.find((thread) => thread.id === openId) ?? threads[0]
  const open = Boolean(openId && threads.some((thread) => thread.id === openId))
  const count = threads.reduce((total, thread) => total + subtreeSize(state, thread.id), 0)
  const quote = primary?.anchor?.quote ?? ''
  const openIndex = threads.findIndex((thread) => thread.id === openId)
  const siblings = threads.length

  return (
    <button
      type="button"
      onClick={onCycle}
      aria-expanded={open}
      aria-label={
        siblings > 1
          ? `${open ? 'Cycle' : 'Open'} ${siblings} branches on “${quote}”`
          : `${open ? 'Hide' : 'Open'} branch on “${quote}” with ${count} ${
              count === 1 ? 'reply' : 'replies'
            }`
      }
      className="group relative flex h-8 w-full cursor-pointer select-none items-center"
    >
      <span
        className={`absolute inset-x-0 top-1/2 h-px transition-colors ${
          open ? 'bg-branch/40' : 'bg-border group-hover:bg-branch/30'
        }`}
      />
      <span
        className={`relative mx-auto flex items-center gap-1.5 rounded-full border bg-paper py-[4px] pl-2.5 pr-2.5 shadow-[0_4px_14px_-6px_rgba(0,0,0,0.7)] transition-transform group-hover:scale-[1.03] ${
          open ? 'border-branch/45' : 'border-border'
        }`}
      >
        <span className="text-[13px] leading-none text-branch">
          {open ? '⌄' : '↳'}
        </span>
        <span className="eyebrow text-muted-foreground">
          {open
            ? siblings > 1 && openIndex < siblings - 1
              ? 'next branch'
              : 'hide branch'
            : truncate(quote, 34)}
        </span>
        {siblings > 1 ? (
          <span className="eyebrow text-branch-bright">
            {openIndex >= 0 ? `${openIndex + 1}/${siblings}` : `${siblings}`}
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
}: ThreadViewProps) {
  const expandedChildId = state.expanded[thread.id] ?? null

  const transcript = (
    <div className="flex flex-col gap-4">
      {lede}
      {thread.messages.length === 0 && emptyLabel ? (
        <p className="text-[13.5px] leading-[1.55] text-muted-foreground">
          {emptyLabel}
        </p>
      ) : null}

      {thread.messages.map((message) => {
        const children = childThreadsForMessage(state, thread.id, message.id)
        const groups = groupThreadsBySpan(children)
        return (
          <div key={message.id} className="flex flex-col gap-0.5">
            <MessageBubble
              message={message}
              threadId={thread.id}
              childThreads={children}
              openChildId={expandedChildId}
              labels={depth === 0}
              compact={depth > 0}
              onSelectMessage={(messageId) =>
                onSelectMessage(thread.id, messageId)
              }
              onOpenBranch={(childId) => onOpenChild(thread.id, childId)}
            />
            {groups.map((group) => {
              const ids = group.map((child) => child.id)
              const openInGroup = ids.includes(expandedChildId ?? '')
                ? expandedChildId
                : null
              const openChild = group.find((child) => child.id === openInGroup)
              return (
                <div key={ids.join(':')}>
                  <BranchRule
                    threads={group}
                    state={state}
                    openId={openInGroup}
                    onCycle={() => onOpenChild(thread.id, cycleOpenId(ids, openInGroup))}
                  />
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
      <div className="flex flex-col gap-3">
        {transcript}
        {composer}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-5 py-5 sm:px-8">
          {transcript}
        </div>
      </ScrollArea>
      <div className="border-t border-border bg-foreground/[0.025] px-5 py-3 sm:px-8">
        <div className="mx-auto max-w-3xl">{composer}</div>
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
          Open as chat ⤢
        </button>
      </div>
    </div>
  )
}
