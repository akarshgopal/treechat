import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowUpRight, GitBranch, Pencil, RotateCw } from 'lucide-react'
import { SourcesList } from '@/components/chat/Citations'
import { MessageAttachments } from '@/components/chat/Attachments'
import { MessageMarkdown } from '@/components/chat/MessageMarkdown'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { threadTitle } from '@/lib/tree'
import type { ChatMessage, MessageUsage, Thread } from '@/types'
import { useModelCatalog } from '@/lib/use-model-catalog'
import { loadModelCapabilities, modelInfo } from '@/lib/model-capabilities'
import { formatCost, formatTokens } from '@/lib/usage'

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
  /** Among the last messages of the thread: touch screens show its actions. */
  latest?: boolean
  /** The citation of this message whose source lane is open. */
  openCitationId?: string | null
  onOpenCitation?: (messageId: string, citationId: string) => void
}

const actionBtn = 'icon-button icon-button-sm'

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
  latest = false,
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
          <button type="button" className="flex min-w-0 items-center gap-2 self-start text-left text-xs text-branch-bright hover:underline" onClick={() => onViewSource(sourceThread.id)} aria-label="View branch" title={threadTitle(sourceThread)}>
            <ArrowUpRight size={14} className="shrink-0" />
            <span className="truncate">{threadTitle(sourceThread)}</span>
          </button>
        ) : <p className="truncate text-xs text-muted-foreground">{message.quote ?? 'Takeaway'}</p>}
        <MessageMarkdown content={message.content} className="text-[15px] leading-[1.62]" />
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
        className="min-h-[42px] resize-none bg-paper px-3 py-2 text-sm leading-[1.5]"
      />
      <div className="flex justify-end gap-1">
        <button
          type="button"
          className="btn"
          onClick={cancelEdit}
          data-testid="message-edit-cancel"
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
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
    ? 'text-sm leading-[1.55]'
    : 'text-[15px] leading-[1.62]'

  const actions = !editing && !hideActions ? (
    <MessageActions
      isUser={isUser}
      onRetry={onRetry ? () => onRetry(message.id) : undefined}
      onEdit={onEdit && isUser ? startEdit : undefined}
      onAsk={onAsk}
      messageId={message.id}
      unanswered={unanswered}
      latest={latest}
      usage={isUser ? undefined : message.usage}
    />
  ) : null

  if (isUser) {
    // An image-only message has no text bubble, just its attachments.
    const bubble = editing || message.content.trim() || !message.attachments
    return (
      <article className="group relative flex flex-col items-end gap-1.5 outline-none" tabIndex={-1}>
        {labels ? <span className="eyebrow text-muted-foreground">you</span> : null}
        {message.attachments ? <MessageAttachments attachments={message.attachments} alignEnd /> : null}
        {bubble ? (
          <div
            className={cn(
              'max-w-[78%] min-w-0 rounded-lg bg-secondary px-3.5 py-2.5 text-foreground',
              editing && 'w-full max-w-[78%]',
              size,
            )}
          >
            {body}
          </div>
        ) : null}
        {actions}
      </article>
    )
  }

  return (
    <article className="group relative flex flex-col gap-1.5 outline-none" tabIndex={-1}>
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
  latest,
  usage,
}: {
  isUser: boolean
  onRetry?: () => void
  onEdit?: () => void
  onAsk?: () => void
  messageId: string
  unanswered: boolean
  latest: boolean
  usage?: MessageUsage
}) {
  if (!onRetry && !onEdit && !onAsk && !usage) return null
  return (
    // Hangs in the gap below the message, so it never takes space of its own.
    // Invisible until hover or focus, but reachable: moving onto a button
    // hovers its message. On touch, invisible buttons must not catch taps, so
    // only the latest messages (or one tapped to focus it) show them, in flow.
    <div
      className={cn(
        'message-actions absolute top-full z-10 flex items-center gap-0.5 pt-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
        unanswered || latest
          ? '[@media(hover:none)]:static [@media(hover:none)]:opacity-100'
          : '[@media(hover:none)]:pointer-events-none [@media(hover:none)]:group-focus-within:pointer-events-auto',
        unanswered && 'opacity-100',
        isUser ? 'right-0 justify-end' : '-left-1.5 justify-start',
      )}
    >
      {onAsk ? <button type="button" className={actionBtn} onClick={onAsk} data-ask-message={messageId} aria-label="Branch from this message" title="Branch from this message"><GitBranch size={14} /></button> : null}
      {onEdit ? (
        <button type="button" className={actionBtn} onClick={onEdit} data-testid="message-edit" aria-label="Edit message" title="Edit & resend">
          <Pencil size={14} />
        </button>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          className={actionBtn}
          onClick={onRetry}
          data-testid={isUser ? 'message-regenerate' : 'message-retry'}
          aria-label={isUser ? 'Regenerate response' : 'Retry'}
          title={isUser ? 'Regenerate response' : 'Retry'}
        >
          <RotateCw size={14} />
        </button>
      ) : null}
      {usage ? <UsageLabel usage={usage} /> : null}
    </div>
  )
}

/** "GPT-4.1 Mini · 1.2k tokens · $0.0031": what this reply cost, from OpenRouter. */
function UsageLabel({ usage }: { usage: MessageUsage }) {
  // The model's display name comes from OpenRouter's public list (cached a day).
  const catalog = useModelCatalog()
  useEffect(() => {
    if (!catalog && usage.model) void loadModelCapabilities()
  }, [catalog, usage.model])
  const model = usage.model ? (modelInfo(usage.model)?.name ?? usage.model.replace(/^[^/]+\//, '')) : undefined
  const total = usage.promptTokens + usage.completionTokens
  const parts = [model, `${formatTokens(total)} tokens`, usage.cost !== undefined ? formatCost(usage.cost) : undefined].filter(Boolean)
  const detail = `${usage.promptTokens.toLocaleString()} in · ${usage.completionTokens.toLocaleString()} out${usage.cost !== undefined ? ` · $${usage.cost.toFixed(6)}` : ''}${usage.model ? ` · ${usage.model}` : ''}`
  return (
    <span className="ml-1.5 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground" title={detail} data-testid="message-usage">
      {parts.join(' · ')}
    </span>
  )
}
