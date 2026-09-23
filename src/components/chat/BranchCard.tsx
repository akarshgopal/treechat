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
  summarized,
}: {
  thread: Thread
  merging?: boolean
  onMerge: () => void
  onDiscard: () => void
  onFocus: () => void
  onHide?: () => void
  children: ReactNode
  summarized?: boolean
}) {
  return (
    <div className="relative pb-0.5 pl-2 pt-0.5 sm:pl-[22px]" data-testid="inline-branch" data-branch-id={thread.id}>
      <span className="branch-spine absolute bottom-2 left-[4px] top-1 w-[2px] rounded-full" />
      <div className="rise flex min-w-0 flex-col gap-3 pl-3 sm:pl-4">
        <BranchHeader
          thread={thread}
          merging={merging}
          onMerge={onMerge}
          onDiscard={onDiscard}
          onFocus={onFocus}
          onHide={onHide}
          summarized={summarized}
        />
        {children}
      </div>
    </div>
  )
}
