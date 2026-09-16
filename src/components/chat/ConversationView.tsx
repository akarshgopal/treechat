import type { RefObject } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { BranchHeader } from '@/components/chat/BranchHeader'
import { Composer } from '@/components/chat/Composer'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { QuoteCard } from '@/components/chat/QuoteCard'
import type { Branch } from '@/types'

type ConversationViewProps = {
  branch: Branch
  draft: string
  onDraftChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  isLoading: boolean
  dropping?: boolean
  onDrop: () => void
  onDiscard: () => void
  onBack: () => void
  composerRef: RefObject<HTMLTextAreaElement | null>
}

export function ConversationView({
  branch,
  draft,
  onDraftChange,
  onSend,
  onStop,
  isLoading,
  dropping,
  onDrop,
  onDiscard,
  onBack,
  composerRef,
}: ConversationViewProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border/80 px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          data-testid="back-to-spine"
        >
          <ArrowLeft className="size-4" />
          Back to spine
        </Button>
        <span className="text-sm text-muted-foreground">Tangent conversation</span>
      </div>
      <div className="border-b border-border/80 px-4 py-3">
        <BranchHeader
          branch={branch}
          dropping={dropping}
          onDrop={onDrop}
          onDiscard={onDiscard}
        />
        <QuoteCard quote={branch.quote} className="mt-3" />
      </div>
      <ScrollArea className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-4 py-4">
          {branch.messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Composer posts only to this tangent. Esc blurs a dirty draft, then
              returns to the spine.
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
      </ScrollArea>
      <div className="border-t border-border/80 bg-background/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-3xl">
          <Composer
            ref={composerRef}
            value={draft}
            onChange={onDraftChange}
            onSend={onSend}
            onStop={onStop}
            isLoading={isLoading}
            placeholder="Post only to this tangent…"
          />
        </div>
      </div>
    </div>
  )
}
