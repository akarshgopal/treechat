import { useMemo, useRef } from 'react'
import { GitBranch } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { splitMarkedText } from '@/lib/selection'
import { cn } from '@/lib/utils'
import type { Branch, ChatMessage } from '@/types'

type MessageBubbleProps = {
  message: ChatMessage
  branches: Branch[]
  openBranchId: string | null
  showGutter?: boolean
  selectable?: boolean
  onSelectMessage?: (messageId: string) => void
  onOpenBranch?: (branchId: string) => void
}

function previewOf(branch: Branch) {
  const last = [...branch.messages].reverse()[0]
  if (!last) return 'Empty branch — open to start the tangent.'
  const prefix = last.role === 'user' ? 'You' : 'Assistant'
  const text = last.content.length > 140 ? `${last.content.slice(0, 140)}…` : last.content
  return `${prefix}: ${text}`
}

export function MessageBubble({
  message,
  branches,
  openBranchId,
  showGutter = true,
  selectable = true,
  onSelectMessage,
  onOpenBranch,
}: MessageBubbleProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const isUser = message.role === 'user'
  const marks = useMemo(
    () =>
      branches.map((branch) => ({
        id: branch.id,
        start: branch.start,
        end: branch.end,
        open: branch.id === openBranchId,
      })),
    [branches, openBranchId],
  )
  const segments = useMemo(
    () => splitMarkedText(message.content, marks),
    [marks, message.content],
  )

  if (message.kind === 'drop-summary') {
    return (
      <article className="flex gap-3 px-1 py-2">
        {showGutter ? <div className="w-7 shrink-0" /> : null}
        <div className="max-w-[min(42rem,100%)] rounded-xl border border-primary/25 bg-accent/50 px-3.5 py-2.5">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
            Dropped from branch
          </p>
          {message.quote ? (
            <p className="mb-1.5 text-xs italic text-muted-foreground">«{message.quote}»</p>
          ) : null}
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{message.content}</p>
        </div>
      </article>
    )
  }

  return (
    <article
      className={cn(
        'group flex gap-3 px-1 py-2',
        isUser ? 'flex-row-reverse' : 'flex-row',
      )}
    >
      {showGutter ? (
        <div className="flex w-7 shrink-0 flex-col items-center gap-1 pt-2">
          {branches.map((branch) => (
            <Tooltip key={branch.id} delayDuration={180}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onOpenBranch?.(branch.id)}
                  className={cn(
                    'flex size-6 items-center justify-center rounded-full border text-[10px] font-semibold transition-colors',
                    branch.id === openBranchId
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-primary/40 bg-paper text-primary hover:bg-accent',
                  )}
                  aria-label={`Open branch with ${branch.messages.length} replies`}
                >
                  {branch.messages.length || <GitBranch className="size-3" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-64 space-y-1">
                <p className="font-medium">«{branch.quote}»</p>
                <p className="text-header-foreground/80">{previewOf(branch)}</p>
                <p className="text-[10px] uppercase tracking-wide text-header-foreground/60">
                  {branch.messages.length}{' '}
                  {branch.messages.length === 1 ? 'reply' : 'replies'}
                </p>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      ) : null}

      <div
        className={cn(
          'max-w-[min(42rem,calc(100%-2rem))] rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed',
          isUser
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'bg-paper text-foreground shadow-sm ring-1 ring-border/80',
        )}
      >
        <div
          ref={bodyRef}
          data-message-id={message.id}
          data-selectable={selectable ? 'true' : 'false'}
          onMouseUp={() => onSelectMessage?.(message.id)}
          className="whitespace-pre-wrap"
        >
          {segments.length === 0
            ? message.content
            : segments.map((segment, index) =>
                segment.mark ? (
                  <Tooltip key={`${segment.mark.id}-${index}`} delayDuration={200}>
                    <TooltipTrigger asChild>
                      <mark
                        className={cn('branch-mark bg-transparent', isUser && 'text-inherit')}
                        data-open={segment.mark.open ? 'true' : 'false'}
                        onClick={(event) => {
                          event.stopPropagation()
                          onOpenBranch?.(segment.mark!.id)
                        }}
                      >
                        {segment.text}
                      </mark>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-64">
                      Hover preview · click to open this branch
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <span key={index}>{segment.text}</span>
                ),
              )}
        </div>
      </div>
    </article>
  )
}
