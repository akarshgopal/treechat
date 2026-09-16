import type { ReactNode, RefObject } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { BranchThread } from '@/components/chat/BranchThread'
import { Composer } from '@/components/chat/Composer'
import { MessageBubble } from '@/components/chat/MessageBubble'
import type { Branch, ChatMessage } from '@/types'

type SpineViewProps = {
  messages: ChatMessage[]
  branches: Branch[]
  openBranch: Branch | null
  onSelectMessage: (messageId: string) => void
  onOpenBranch: (branchId: string) => void
  spineDraft: string
  onSpineDraftChange: (value: string) => void
  onSpineSend: () => void
  onSpineStop: () => void
  spineLoading: boolean
  spineComposerRef: RefObject<HTMLTextAreaElement | null>
  onSpineFocus: () => void
  banner: ReactNode
  branchDraft: string
  onBranchDraftChange: (value: string) => void
  onBranchSend: () => void
  onBranchStop: () => void
  branchLoading: boolean
  dropping?: boolean
  onDrop: () => void
  onDiscard: () => void
  onOpenConversation: () => void
  branchComposerRef: RefObject<HTMLTextAreaElement | null>
  onBranchFocus: () => void
}

export function SpineView({
  messages,
  branches,
  openBranch,
  onSelectMessage,
  onOpenBranch,
  spineDraft,
  onSpineDraftChange,
  onSpineSend,
  onSpineStop,
  spineLoading,
  spineComposerRef,
  onSpineFocus,
  banner,
  branchDraft,
  onBranchDraftChange,
  onBranchSend,
  onBranchStop,
  branchLoading,
  dropping,
  onDrop,
  onDiscard,
  onOpenConversation,
  branchComposerRef,
  onBranchFocus,
}: SpineViewProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-3 py-5 sm:px-4">
          {messages.map((message) => {
            const messageBranches = branches.filter(
              (branch) => branch.sourceMessageId === message.id,
            )
            const inline =
              openBranch && openBranch.sourceMessageId === message.id
                ? openBranch
                : null
            return (
              <div key={message.id} className="mb-1">
                <MessageBubble
                  message={message}
                  branches={messageBranches}
                  openBranchId={openBranch?.id ?? null}
                  onSelectMessage={onSelectMessage}
                  onOpenBranch={onOpenBranch}
                />
                {inline ? (
                  <BranchThread
                    branch={inline}
                    draft={branchDraft}
                    onDraftChange={onBranchDraftChange}
                    onSend={onBranchSend}
                    onStop={onBranchStop}
                    isLoading={branchLoading}
                    dropping={dropping}
                    onDrop={onDrop}
                    onDiscard={onDiscard}
                    onOpenConversation={onOpenConversation}
                    composerRef={branchComposerRef}
                    onComposerFocus={onBranchFocus}
                  />
                ) : null}
              </div>
            )
          })}
        </div>
      </ScrollArea>
      <div className="border-t border-border/80 bg-background/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-3xl">
          <Composer
            ref={spineComposerRef}
            value={spineDraft}
            onChange={onSpineDraftChange}
            onSend={onSpineSend}
            onStop={onSpineStop}
            isLoading={spineLoading}
            onFocus={onSpineFocus}
            placeholder="Message the spine…"
            banner={banner}
          />
        </div>
      </div>
    </div>
  )
}
