import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { QuoteCard } from '@/components/chat/QuoteCard'
import type { Thread } from '@/types'

type BranchHeaderProps = {
  thread: Thread
  /** e.g. "branch · 2 replies" — defaults to a reply count. */
  eyebrow?: string
  merging?: boolean
  onMerge: () => void
  onDiscard: () => void
  /** Omitted when this thread already holds the frame. */
  onFocus?: () => void
  onHide?: () => void
}

const quiet =
  'rounded-md px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-50'

const accent =
  'rounded-md px-1.5 py-0.5 text-[10.5px] font-medium text-branch-bright transition-colors hover:bg-branch/15 disabled:opacity-50'

export function BranchHeader({
  thread,
  eyebrow,
  merging,
  onMerge,
  onDiscard,
  onFocus,
  onHide,
}: BranchHeaderProps) {
  const [confirm, setConfirm] = useState(false)
  const count = thread.messages.length
  const quote = thread.anchor?.quote ?? ''

  return (
    <>
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="eyebrow text-branch">
            {eyebrow ?? `branch · ${count} ${count === 1 ? 'reply' : 'replies'}`}
          </span>
          {onHide ? (
            <button
              type="button"
              className={quiet}
              onClick={onHide}
              data-testid="hide-branch"
              aria-label="Hide this branch"
            >
              hide ⌄
            </button>
          ) : null}
        </div>
        <QuoteCard quote={quote} />
        <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
          <button
            type="button"
            className={accent}
            onClick={onMerge}
            disabled={merging}
            data-testid="drop-summary"
          >
            {merging ? 'Merging…' : 'Merge up ↑'}
          </button>
          {onFocus ? (
            <button
              type="button"
              className={accent}
              onClick={onFocus}
              data-testid="open-as-conversation"
            >
              Open as chat ⤢
            </button>
          ) : null}
          <button
            type="button"
            className={`${quiet} hover:text-destructive`}
            onClick={() => setConfirm(true)}
          >
            Discard
          </button>
        </div>
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this branch?</AlertDialogTitle>
            <AlertDialogDescription>
              The tangent on “{quote}” and its {count}{' '}
              {count === 1 ? 'reply' : 'replies'} will be removed, along with any
              branches growing out of it. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep branch</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onDiscard}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
