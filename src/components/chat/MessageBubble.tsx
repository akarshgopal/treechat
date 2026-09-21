import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Check, Pencil, RotateCw, X } from 'lucide-react'
import { MessageMarkdown } from '@/components/chat/MessageMarkdown'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
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
  onRetry?: (messageId: string) => void
  onEdit?: (messageId: string, content: string) => void
}

const actionBtn =
  'flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-40'

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
  onRetry,
  onEdit,
}: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const editRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!editing) return
    const el = editRef.current
    if (!el) return
    el.focus()
    el.selectionStart = el.value.length
    el.selectionEnd = el.value.length
  }, [editing])

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

  const startEdit = () => {
    setDraft(message.content)
    setEditing(true)
  }

  const cancelEdit = () => {
    setDraft(message.content)
    setEditing(false)
  }

  const confirmEdit = () => {
    const text = draft.trim()
    if (!text) return
    setEditing(false)
    onEdit?.(message.id, text)
  }

  const onEditKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cancelEdit()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      confirmEdit()
    }
  }

  const body = editing ? (
    <div className="flex w-full flex-col gap-1.5">
      <Textarea
        ref={editRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onEditKeyDown}
        data-testid="message-edit-input"
        rows={Math.min(8, Math.max(2, draft.split('\n').length))}
        className="min-h-[42px] resize-none bg-paper px-3 py-2 text-[13.5px] leading-[1.5]"
      />
      <div className="flex justify-end gap-1">
        <button
          type="button"
          className={actionBtn}
          onClick={cancelEdit}
          data-testid="message-edit-cancel"
          aria-label="Cancel edit"
        >
          <X className="size-3.5" />
        </button>
        <button
          type="button"
          className={actionBtn}
          onClick={confirmEdit}
          disabled={!draft.trim()}
          data-testid="message-edit-save"
          aria-label="Save and resend"
        >
          <Check className="size-3.5" />
        </button>
      </div>
    </div>
  ) : (
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

  const actions = !editing ? (
    <MessageActions
      isUser={isUser}
      onRetry={onRetry && !isUser ? () => onRetry(message.id) : undefined}
      onEdit={onEdit && isUser ? startEdit : undefined}
    />
  ) : null

  if (isUser) {
    return (
      <article className="group flex flex-col items-end gap-1.5">
        {labels ? <span className="eyebrow text-muted-foreground">you</span> : null}
        <div
          className={cn(
            'max-w-[78%] min-w-0 rounded-[9px] bg-branch/10 px-3.5 py-2.5 text-foreground',
            editing && 'w-full max-w-[78%]',
            size,
          )}
        >
          {body}
        </div>
        {actions}
      </article>
    )
  }

  return (
    <article className="group flex flex-col gap-1.5">
      {labels ? <span className="eyebrow text-muted-foreground">treechat</span> : null}
      <div className={cn('text-foreground', size)}>{body}</div>
      {actions}
    </article>
  )
}

function MessageActions({
  isUser,
  onRetry,
  onEdit,
}: {
  isUser: boolean
  onRetry?: () => void
  onEdit?: () => void
}) {
  if (!onRetry && !onEdit) return null
  return (
    <div
      className={cn(
        'flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100',
        isUser ? 'justify-end' : 'justify-start',
      )}
    >
      {onEdit ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={actionBtn}
              onClick={onEdit}
              data-testid="message-edit"
              aria-label="Edit message"
            >
              <Pencil className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Edit & resend</TooltipContent>
        </Tooltip>
      ) : null}
      {onRetry ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={actionBtn}
              onClick={onRetry}
              data-testid="message-retry"
              aria-label="Retry"
            >
              <RotateCw className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Retry</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}
