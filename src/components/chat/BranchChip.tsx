import { GitBranch } from 'lucide-react'
import { createPortal } from 'react-dom'

type BranchChipProps = {
  top: number
  left: number
  onBranch: () => void
}

export function BranchChip({ top, left, onBranch }: BranchChipProps) {
  return createPortal(
    <button
      type="button"
      className="selection-chip fixed z-50 inline-flex -translate-x-1/2 -translate-y-full items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"
      style={{ top: Math.max(8, top - 10), left }}
      onMouseDown={(event) => event.preventDefault()}
      data-testid="branch-chip"
      onClick={onBranch}
    >
      <GitBranch className="size-3.5" />
      Branch
    </button>,
    document.body,
  )
}
