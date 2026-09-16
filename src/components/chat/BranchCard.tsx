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
  children,
}: {
  thread: Thread
  merging?: boolean
  onMerge: () => void
  onDiscard: () => void
  onFocus: () => void
  children: ReactNode
}) {
  return (
    <div className="relative pb-1 pl-[26px] pt-0.5">
      <span className="branch-spine absolute bottom-2.5 left-[5px] top-1.5 w-[2px] rounded-sm" />
      <div className="rise flex flex-col gap-[13px] rounded-[9px] border border-branch/25 bg-branch/[0.07] px-[15px] py-[13px]">
        <BranchHeader
          thread={thread}
          merging={merging}
          onMerge={onMerge}
          onDiscard={onDiscard}
          onFocus={onFocus}
        />
        <span className="h-px bg-branch/30" />
        {children}
      </div>
    </div>
  )
}
