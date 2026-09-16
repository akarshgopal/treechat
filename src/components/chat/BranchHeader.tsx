import { useState } from 'react'
import { GitMerge, Maximize2, Trash2 } from 'lucide-react'
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
import { Button } from '@/components/ui/button'
import type { Branch } from '@/types'

type BranchHeaderProps = {
  branch: Branch
  dropping?: boolean
  onDrop: () => void
  onDiscard: () => void
  onOpenConversation?: () => void
}

export function BranchHeader({
  branch,
  dropping,
  onDrop,
  onDiscard,
  onOpenConversation,
}: BranchHeaderProps) {
  const [confirm, setConfirm] = useState(false)

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
          Branch · {branch.messages.length}{' '}
          {branch.messages.length === 1 ? 'reply' : 'replies'}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onDrop}
            disabled={dropping}
            data-testid="drop-summary"
          >
            <GitMerge className="size-3.5" />
            {dropping ? 'Dropping…' : 'Drop summary into main'}
          </Button>
          {onOpenConversation ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onOpenConversation}
              data-testid="open-as-conversation"
            >
              <Maximize2 className="size-3.5" />
              Open as conversation
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirm(true)}
          >
            <Trash2 className="size-3.5" />
            Discard
          </Button>
        </div>
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this branch?</AlertDialogTitle>
            <AlertDialogDescription>
              The tangent on «{branch.quote}» and its {branch.messages.length}{' '}
              {branch.messages.length === 1 ? 'reply' : 'replies'} will be removed.
              This cannot be undone.
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
