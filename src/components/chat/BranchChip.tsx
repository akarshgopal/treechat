import { createPortal } from 'react-dom'

type BranchChipProps = {
  top: number
  left: number
  /** Branches already hanging off this exact span. */
  existing?: number
  onBranch: () => void
}

export function BranchChip({ top, left, existing = 0, onBranch }: BranchChipProps) {
  return createPortal(
    <button
      type="button"
      className="selection-chip fixed z-50 inline-flex -translate-x-1/2 -translate-y-full items-center gap-2 rounded-full border border-branch/40 bg-paper py-[5px] pl-2.5 pr-3 transition-colors hover:bg-branch/15"
      style={{ top: Math.max(10, top - 10), left }}
      onMouseDown={(event) => event.preventDefault()}
      data-testid="branch-chip"
      onClick={onBranch}
    >
      <span className="text-[13px] leading-none text-branch">↳</span>
      <span className="eyebrow text-branch-bright">
        {existing > 0 ? `branch again · ${existing + 1}` : 'branch from selection'}
      </span>
    </button>,
    document.body,
  )
}
