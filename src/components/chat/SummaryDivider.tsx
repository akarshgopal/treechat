import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ThreadSummary } from '@/types'

/**
 * Sits before the first message still sent to the model in full, so it is
 * visible that everything above reaches the model only as a summary.
 */
export function SummaryDivider({ summary }: { summary: ThreadSummary }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  return (
    <div className="my-1 flex flex-col gap-2" data-testid="summary-divider">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span aria-hidden className="h-px flex-1 bg-border" />
        <button
          type="button"
          className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-secondary hover:text-foreground"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
        >
          Earlier messages are summarized for the model
          <ChevronDown size={13} aria-hidden className={cn('transition-transform', open && 'rotate-180')} />
        </button>
        <span aria-hidden className="h-px flex-1 bg-border" />
      </div>
      {open ? (
        <div id={panelId} className="whitespace-pre-wrap rounded-md border border-border bg-foreground/[0.025] px-3 py-2 text-[13px] leading-relaxed text-muted-foreground" data-testid="summary-text">
          {summary.content}
        </div>
      ) : null}
    </div>
  )
}
