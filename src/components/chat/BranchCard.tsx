import type { ReactNode } from 'react'
import { BranchHeader } from '@/components/chat/BranchHeader'
import type { Thread } from '@/types'

/** The accent-bordered card an expanded branch lives in, inside its parent. */
export function BranchCard({
  thread,
  merging,
  onMerge,
  onDiscard,
  onFocus,
  onHide,
  children,
}: {
  thread: Thread
  merging?: boolean
  onMerge: () => void
  onDiscard: () => void
  onFocus: () => void
  onHide?: () => void
  children: ReactNode
}) {
  return (
    <div className="relative pb-0.5 pl-[22px] pt-0.5">
      <span className="branch-spine absolute bottom-2 left-[4px] top-1 w-[2px] rounded-full" />
      <div className="rise flex flex-col gap-3 rounded-[9px] border border-branch/20 bg-branch/[0.05] px-3.5 py-3">
        <BranchHeader
          thread={thread}
          merging={merging}
          onMerge={onMerge}
          onDiscard={onDiscard}
          onFocus={onFocus}
          onHide={onHide}
        />
        <span className="h-px bg-branch/20" />
        {children}
      </div>
    </div>
  )
}
