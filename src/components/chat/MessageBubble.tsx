import { useMemo } from 'react'
import { MessageMarkdown } from '@/components/chat/MessageMarkdown'
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
          <MessageMarkdown content={message.content} className="text-[14.5px] leading-[1.62]" />
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
      className="text-pretty"
    >
      <MessageMarkdown
        content={message.content}
        marks={marks}
        onOpenBranch={onOpenBranch}
      />
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
            'max-w-[78%] min-w-0 rounded-[9px] bg-branch/10 px-3.5 py-2.5 text-foreground',
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
