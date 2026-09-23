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
import { ArrowLeft, ArrowUpLeft, Check, GitBranch, Maximize2, Trash2, X } from 'lucide-react'
import { threadTitle } from '@/lib/tree'
import type { Thread } from '@/types'

type BranchHeaderProps = {
  thread: Thread
  merging?: boolean
  onMerge: () => void
  onDiscard: () => void
  /** Omitted when this thread already holds the frame. */
  onFocus?: () => void
  onHide?: () => void
  onReturn?: () => void
  summarized?: boolean
}

export function BranchHeader({
  thread,
  merging,
  onMerge,
  onDiscard,
  onFocus,
  onHide,
  onReturn,
  summarized,
}: BranchHeaderProps) {
  const [confirm, setConfirm] = useState(false)
  const count = thread.messages.length
  const quote = thread.anchor?.quote ?? ''

  return (
    <>
      <div className="flex min-w-0 items-center gap-1.5">
        {onReturn ? (
          <button type="button" className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-2 text-left text-sm text-muted-foreground hover:text-foreground" onClick={onReturn} data-testid="back-to-spine" aria-label="Back to passage" title={`Back to passage: ${quote}`}>
            <ArrowLeft size={16} className="shrink-0" />
            <span className="truncate">{quote}</span>
          </button>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground" title={threadTitle(thread)}>
            <GitBranch size={15} className="shrink-0 text-branch" aria-hidden />
            <span className="truncate">{threadTitle(thread)}</span>
          </span>
        )}
        {summarized ? <Check size={14} className="shrink-0 text-branch" aria-label="Takeaway shared" /> : null}
        {thread.messages.some((message) => message.role === 'assistant' && message.content.trim()) ? (
          <button type="button" className="branch-secondary shrink-0 text-branch-bright" onClick={onMerge} disabled={merging} data-testid="drop-summary" title="Review a takeaway for the parent conversation">
            <ArrowUpLeft size={15} /> Bring back
          </button>
        ) : null}
        {onFocus ? (
          <button type="button" className="branch-icon-button" onClick={onFocus} data-testid="open-as-conversation" aria-label="Expand branch" title="Expand branch">
            <Maximize2 size={15} />
          </button>
        ) : null}
        <button type="button" className="branch-icon-button hover:text-destructive" onClick={() => setConfirm(true)} data-testid="discard-branch" aria-label="Discard branch" title="Discard branch">
          <Trash2 size={15} />
        </button>
        {onHide ? <button type="button" className="branch-icon-button" onClick={onHide} data-testid="hide-branch" aria-label="Hide this branch" title="Hide branch"><X size={15} /></button> : null}
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this branch?</AlertDialogTitle>
            <AlertDialogDescription>
              The tangent on “{quote}” and its {count}{' '}
              {count === 1 ? 'message' : 'messages'} will be removed, along with any
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
