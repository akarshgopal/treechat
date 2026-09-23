import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowUpRight, GitBranch, Pencil, RotateCw } from 'lucide-react'
import { SourcesList } from '@/components/chat/Citations'
import { MessageMarkdown } from '@/components/chat/MessageMarkdown'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { threadTitle } from '@/lib/tree'
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
  onEdit?: (messageId: string, content: string) => Promise<boolean>
  onAsk?: () => void
  sourceThread?: Thread
  onViewSource?: (threadId: string) => void
  hideActions?: boolean
  unanswered?: boolean
  /** The citation of this message whose source lane is open. */
  openCitationId?: string | null
  onOpenCitation?: (messageId: string, citationId: string) => void
}

const actionBtn =
  'flex size-7 items-center justify-center rounded-md [@media(hover:none)]:size-9 text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-40'

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
  onAsk,
  sourceThread,
  onViewSource,
  hideActions = false,
  unanswered = false,
  openCitationId = null,
  onOpenCitation,
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
      <article className="rise flex flex-col gap-2 rounded-xl border border-branch/25 bg-branch/[0.05] p-4" data-takeaway-id={message.id}>
        {sourceThread && onViewSource ? (
          <button type="button" className="flex min-w-0 items-center gap-2 self-start text-left text-xs text-branch-bright hover:underline" onClick={() => onViewSource(sourceThread.id)} aria-label="View exploration" title={threadTitle(sourceThread)}>
            <ArrowUpRight size={14} className="shrink-0" />
            <span className="truncate">{threadTitle(sourceThread)}</span>
          </button>
        ) : <p className="truncate text-xs text-muted-foreground">{message.quote ?? 'Takeaway'}</p>}
        <MessageMarkdown content={message.content} className="text-[14.5px] leading-[1.62]" />
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

  const confirmEdit = async () => {
    const text = draft.trim()
    if (!text) return
    setEditing(false)
    const applied = await onEdit?.(message.id, text)
    if (applied === false) setEditing(true)
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
      void confirmEdit()
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
          className="branch-secondary text-xs text-muted-foreground"
          onClick={cancelEdit}
          data-testid="message-edit-cancel"
        >
          Cancel
        </button>
        <button
          type="button"
          className="branch-secondary text-xs text-branch-bright"
          onClick={() => void confirmEdit()}
          disabled={!draft.trim()}
          data-testid="message-edit-save"
        >
          Save &amp; resend
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
        citations={message.citations}
        openCitationId={openCitationId}
        onOpenCitation={onOpenCitation ? (citationId) => onOpenCitation(message.id, citationId) : undefined}
      />
    </div>
  )
  // Outside the selectable body: the list is chrome, not message text.
  const sources = !editing && !isUser && message.citations?.length ? (
    <SourcesList
      messageId={message.id}
      citations={message.citations}
      openId={openCitationId}
      onOpen={onOpenCitation ? (citationId) => onOpenCitation(message.id, citationId) : undefined}
    />
  ) : null

  const size = compact
    ? 'text-[13.5px] leading-[1.55]'
    : 'text-[14.5px] leading-[1.62]'

  const actions = !editing && !hideActions ? (
    <MessageActions
      isUser={isUser}
      onRetry={onRetry ? () => onRetry(message.id) : undefined}
      onEdit={onEdit && isUser ? startEdit : undefined}
      onAsk={onAsk}
      messageId={message.id}
      unanswered={unanswered}
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
      {sources}
      {actions}
    </article>
  )
}

function MessageActions({
  isUser,
  onRetry,
  onEdit,
  onAsk,
  messageId,
  unanswered,
}: {
  isUser: boolean
  onRetry?: () => void
  onEdit?: () => void
  onAsk?: () => void
  messageId: string
  unanswered: boolean
}) {
  if (!onRetry && !onEdit && !onAsk) return null
  return (
    <div
      className={cn(
        'message-actions flex gap-0.5 text-xs opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100',
        unanswered && 'opacity-100',
        isUser ? 'justify-end' : 'justify-start',
      )}
    >
      {onAsk ? <button type="button" className={actionBtn} onClick={onAsk} data-ask-message={messageId} aria-label="Branch from this message" title="Branch"><GitBranch size={15} /></button> : null}
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
              data-testid={isUser ? 'message-regenerate' : 'message-retry'}
              aria-label={isUser ? 'Regenerate response' : 'Retry'}
            >
              <RotateCw className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{isUser ? 'Regenerate response' : 'Retry'}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}
