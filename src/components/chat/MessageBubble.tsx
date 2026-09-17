import { useMemo } from 'react'
import { splitMarkedText } from '@/lib/selection'
import { cn } from '@/lib/utils'
import type { ChatMessage, Thread } from '@/types'

type MessageBubbleProps = {
  message: ChatMessage
  /** Threads anchored inside this message. */
  childThreads: Thread[]
  openChildId: string | null
  /** Show the `you` / `treechat` eyebrow above the message. */
  labels?: boolean
  selectable?: boolean
  compact?: boolean
  onSelectMessage?: (messageId: string) => void
  onOpenBranch?: (threadId: string) => void
}

export function MessageBubble({
  message,
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
      <article className="rise flex flex-col gap-2 py-1">
        <div className="flex items-center gap-2.5">
          <span className="accent-glow h-4 w-[2px] shrink-0 rounded-sm bg-branch" />
          <span className="eyebrow text-branch">merged from branch</span>
        </div>
        <div className="rounded-[9px] border border-branch/25 bg-branch/[0.07] px-4 py-3">
          {message.quote ? (
            <p className="mb-2 text-[13px] italic leading-snug text-muted-foreground">
              “{message.quote}”
            </p>
          ) : null}
          <p className="whitespace-pre-wrap text-[14.5px] leading-[1.68] text-foreground text-pretty">
            {message.content}
          </p>
        </div>
      </article>
    )
  }

  const body = (
    <div
      data-message-id={message.id}
      data-selectable={selectable ? 'true' : 'false'}
      onMouseUp={() => onSelectMessage?.(message.id)}
      className="whitespace-pre-wrap text-pretty"
    >
      {segments.length === 0
        ? message.content
        : segments.map((segment, index) => {
            if (!segment.marks) return <span key={index}>{segment.text}</span>
            const siblings = segment.marks
            const openIndex = siblings.findIndex((mark) => mark.open)
            // Click cycles: none open → first, then each sibling, then closed.
            const next = siblings[openIndex + 1] ?? siblings[openIndex] ?? siblings[0]
            return (
              <mark
                key={`${siblings[0].id}-${index}`}
                className="branch-mark bg-transparent text-inherit"
                data-open={openIndex >= 0 ? 'true' : 'false'}
                data-siblings={siblings.length > 1 ? 'true' : 'false'}
                title={
                  siblings.length > 1
                    ? `${siblings.length} branches here — click to cycle`
                    : 'Open this branch'
                }
                onClick={(event) => {
                  event.stopPropagation()
                  onOpenBranch?.(next.id)
                }}
              >
                {segment.text}
                {siblings.length > 1 ? (
                  <sup className="ml-0.5 font-mono text-[9px] font-medium text-branch-bright">
                    {openIndex >= 0 ? `${openIndex + 1}/` : ''}
                    {siblings.length}
                  </sup>
                ) : null}
              </mark>
            )
          })}
    </div>
  )

  const size = compact
    ? 'text-[13.5px] leading-[1.6]'
    : 'text-[14.5px] leading-[1.68]'

  if (isUser) {
    return (
      <article className="flex flex-col items-end gap-[7px]">
        {labels ? <span className="eyebrow text-muted-foreground">you</span> : null}
        <div
          className={cn(
            'max-w-[78%] rounded-[9px] bg-branch/10 px-[15px] py-3 text-foreground',
            size,
          )}
        >
          {body}
        </div>
      </article>
    )
  }

  return (
    <article className="flex flex-col gap-2">
      {labels ? <span className="eyebrow text-muted-foreground">treechat</span> : null}
      <div className={cn('text-foreground', size)}>{body}</div>
    </article>
  )
}
