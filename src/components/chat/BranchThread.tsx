import type { RefObject } from 'react'
import { Separator } from '@/components/ui/separator'
import { BranchHeader } from '@/components/chat/BranchHeader'
import { Composer } from '@/components/chat/Composer'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { QuoteCard } from '@/components/chat/QuoteCard'
import type { Branch } from '@/types'

type BranchThreadProps = {
  branch: Branch
  draft: string
  onDraftChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  isLoading: boolean
  dropping?: boolean
  onDrop: () => void
  onDiscard: () => void
  onOpenConversation: () => void
  composerRef: RefObject<HTMLTextAreaElement | null>
  onComposerFocus: () => void
}

export function BranchThread({
  branch,
  draft,
  onDraftChange,
  onSend,
  onStop,
  isLoading,
  dropping,
  onDrop,
  onDiscard,
  onOpenConversation,
  composerRef,
  onComposerFocus,
}: BranchThreadProps) {
  return (
    <div className="ml-10 mt-1 rounded-xl border border-primary/20 bg-accent/25 p-3">
      <BranchHeader
        branch={branch}
        dropping={dropping}
        onDrop={onDrop}
        onDiscard={onDiscard}
        onOpenConversation={onOpenConversation}
      />
      <QuoteCard quote={branch.quote} className="mt-2" />
      <Separator className="my-3 bg-primary/15" />
      <div className="space-y-1">
        {branch.messages.length === 0 ? (
          <p className="px-1 py-2 text-sm text-muted-foreground">
            This tangent is empty. Write below — it stays on the branch.
          </p>
        ) : (
          branch.messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              branches={[]}
              openBranchId={null}
              showGutter={false}
              selectable={false}
            />
          ))
        )}
      </div>
      <Composer
        ref={composerRef}
        className="mt-3"
        value={draft}
        onChange={onDraftChange}
        onSend={onSend}
        onStop={onStop}
        isLoading={isLoading}
        onFocus={onComposerFocus}
        placeholder="Reply on this branch…"
      />
    </div>
  )
}
