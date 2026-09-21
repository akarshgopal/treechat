import { createPortal } from 'react-dom'
import { branchShortcutLabel } from '@/lib/utils'

type BranchChipProps = {
  top: number
  left: number
  /** Bottom of the selection, used to flip the chip when there is no room above. */
  bottom?: number
  /** Branches already hanging off this exact span. */
  existing?: number
  onBranch: () => void
  onHold?: () => void
}

export function BranchChip({
  top,
  left,
  bottom = top,
  existing = 0,
  onBranch,
  onHold,
}: BranchChipProps) {
  const placeAbove = top >= 52
  const chipTop = placeAbove ? Math.max(8, top - 8) : bottom + 8
  const chipLeft = Math.min(
    Math.max(left, 132),
    typeof window === 'undefined' ? left : window.innerWidth - 132,
  )
  const label = existing > 0 ? `Branch again · ${existing + 1}` : 'Branch from selection'
  const shortcut = branchShortcutLabel()

  return createPortal(
    <button
      type="button"
      className={`selection-chip pointer-events-auto fixed z-50 inline-flex items-center gap-1.5 rounded-full border border-border bg-paper py-[5px] pl-2.5 pr-2.5 ${
        placeAbove ? '-translate-x-1/2 -translate-y-full' : '-translate-x-1/2'
      }`}
      style={{ top: chipTop, left: chipLeft }}
      onMouseDown={(event) => {
        event.preventDefault()
        onHold?.()
      }}
      data-testid="branch-chip"
      data-placement={placeAbove ? 'above' : 'below'}
      aria-keyshortcuts="Control+Shift+B Meta+Shift+B"
      title={`${label} · ${shortcut}`}
      onClick={onBranch}
    >
      <span className="text-[13px] leading-none text-branch" aria-hidden>
        ↳
      </span>
      <span className="text-[12.5px] font-medium leading-none text-foreground">{label}</span>
      <span className="text-[11px] leading-none text-muted-foreground">{shortcut}</span>
    </button>,
    document.body,
  )
}
