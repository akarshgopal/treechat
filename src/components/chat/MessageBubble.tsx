import { useMemo } from 'react'
import { cycleOpenId } from '@/lib/tree'
import { splitMarkedText } from '@/lib/selection'
import { cn } from '@/lib/utils'
import type { ChatMessage, Thread } from '@/types'

type MessageBubbleProps = {
  message: ChatMessage
  threadId: string
  /** Threads anchored inside this message. */
  childThreads: Thread[]
  openChildId: string | null
  /** Show the `you` / `treechat` eyebrow above the message. */
  labels?: boolean
  selectable?: boolean
  compact?: boolean
  onSelectMessage?: (messageId: string) => void
  onOpenBranch?: (threadId: string | null) => void
}

export function MessageBubble({
  message,
  threadId,
  childThreads,
  openChildId,
  labels = true,
  selectable = true,
  compact = false,
  onSelectMessage,
  onOpenBranch,
}: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const marks = useMemo(
    () =>
      childThreads.flatMap((thread) =>
        thread.anchor
          ? [
              {
                id: thread.id,
                start: thread.anchor.start,
                end: thread.anchor.end,
                open: thread.id === openChildId,
              },
            ]
          : [],
      ),
    [childThreads, openChildId],
  )
  const segments = useMemo(
    () => splitMarkedText(message.content, marks),
    [marks, message.content],
  )

  if (message.kind === 'drop-summary') {
    return (
      <article className="rise flex flex-col gap-1.5 py-0.5">
        <div className="flex items-center gap-2.5">
          <span className="accent-glow h-3.5 w-[2px] shrink-0 rounded-sm bg-branch" />
          <span className="eyebrow text-branch">merged from branch</span>
        </div>
        <div className="rounded-[9px] border border-branch/20 bg-branch/[0.05] px-3.5 py-2.5">
          {message.quote ? (
            <p className="mb-1.5 text-[13px] italic leading-snug text-muted-foreground">
              “{message.quote}”
            </p>
          ) : null}
          <p className="whitespace-pre-wrap text-[14.5px] leading-[1.62] text-foreground text-pretty">
            {message.content}
          </p>
        </div>
      </article>
    )
  }

  const body = (
    <div
      data-message-id={message.id}
      data-thread-id={threadId}
      data-selectable={selectable ? 'true' : 'false'}
      onMouseUp={() => onSelectMessage?.(message.id)}
      className="whitespace-pre-wrap text-pretty"
    >
      {segments.length === 0
        ? message.content
        : segments.map((segment, index) => {
            if (!segment.marks) return <span key={index}>{segment.text}</span>
            const siblings = segment.marks
            const ids = siblings.map((mark) => mark.id)
            const openIndex = siblings.findIndex((mark) => mark.open)
            const nextId = cycleOpenId(ids, openIndex >= 0 ? siblings[openIndex].id : null)
            return (
              <mark
                key={`${siblings[0].id}-${index}`}
                className="branch-mark bg-transparent text-inherit"
                data-open={openIndex >= 0 ? 'true' : 'false'}
                data-siblings={siblings.length > 1 ? 'true' : 'false'}
                data-count={siblings.length}
                title={
                  siblings.length > 1
                    ? `${siblings.length} branches here — click to cycle`
                    : openIndex >= 0
                      ? 'Hide this branch'
                      : 'Open this branch'
                }
                onClick={(event) => {
                  event.stopPropagation()
                  onOpenBranch?.(nextId)
                }}
              >
                {segment.text}
                {siblings.length > 1 ? (
                  <sup className="ml-0.5 font-mono text-[9px] font-medium tracking-wide text-branch-bright">
                    {openIndex >= 0 ? `${openIndex + 1}/${siblings.length}` : siblings.length}
                  </sup>
                ) : null}
              </mark>
            )
          })}
    </div>
  )

  const size = compact
    ? 'text-[13.5px] leading-[1.55]'
    : 'text-[14.5px] leading-[1.62]'

  if (isUser) {
    return (
      <article className="flex flex-col items-end gap-1.5">
        {labels ? <span className="eyebrow text-muted-foreground">you</span> : null}
        <div
          className={cn(
            'max-w-[78%] rounded-[9px] bg-branch/10 px-3.5 py-2.5 text-foreground',
            size,
          )}
        >
          {body}
        </div>
      </article>
    )
  }

  return (
    <article className="flex flex-col gap-1.5">
      {labels ? <span className="eyebrow text-muted-foreground">treechat</span> : null}
      <div className={cn('text-foreground', size)}>{body}</div>
    </article>
  )
}
