import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { branchTakeaway, childThreads, clipText, markdownToPlain, threadTitle } from '@/lib/tree'
import { unreadCount } from '@/lib/unread'
import { cn } from '@/lib/utils'
import type { Thread, TreeState } from '@/types'

/**
 * The whole chat at a glance: the main thread on top, its branches in a row
 * beneath, and their branches nested under each. A card opens its thread.
 */
export function MapOverlay({ state, title, narrow, onOpen, onClose }: {
  state: TreeState
  title: string
  narrow: boolean
  onOpen: (threadId: string) => void
  onClose: () => void
}) {
  const root = state.threads[state.rootId]
  const branches = root ? childThreads(state, root.id) : []
  const total = Object.keys(state.threads).length - 1
  const fresh = unreadCount(state)
  const gist = root?.messages.find((message) => message.role === 'assistant' && message.kind !== 'drop-summary' && message.content.trim())?.content
  const open = (threadId: string) => {
    onOpen(threadId)
    onClose()
  }
  return (
    <DialogPrimitive.Root open onOpenChange={(value) => { if (!value) onClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col bg-rail outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0"
          data-testid="map"
          aria-describedby={undefined}
        >
          <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
            <DialogPrimitive.Title className="text-[13px] font-medium text-foreground">Map</DialogPrimitive.Title>
            <span className="flex-1 font-mono text-[11px] text-muted-foreground" data-testid="map-counts">
              {total} {total === 1 ? 'branch' : 'branches'}{fresh > 0 ? ` · ${fresh} new` : ''}
            </span>
            <DialogPrimitive.Close className="icon-button" aria-label="Close map" title="Close · Esc">
              <X size={16} />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <div className={cn('flex flex-col items-center px-4 pb-12 pt-8', !narrow && 'mx-auto w-max min-w-full px-10')}>
              {root ? (
                <button
                  type="button"
                  onClick={() => open(root.id)}
                  className={cn(mapCard, 'w-[360px] max-w-full', state.activeThreadId === root.id && currentCard)}
                  data-testid="map-card"
                  data-thread-id={root.id}
                  aria-current={state.activeThreadId === root.id ? 'true' : undefined}
                >
                  <span className="text-[15px] font-semibold">{title}</span>
                  {gist ? <span className="line-clamp-3 text-muted-foreground">{clipText(markdownToPlain(gist), 220)}</span> : null}
                </button>
              ) : null}
              {branches.length > 0 ? (
                <>
                  <span className="h-7 w-px bg-border" aria-hidden />
                  <div className={cn('flex gap-5 border-t border-border pt-4', narrow ? 'w-full flex-col items-stretch' : 'items-start justify-center')}>
                    {branches.map((branch) => (
                      <MapBranch key={branch.id} thread={branch} state={state} narrow={narrow} onOpen={open} />
                    ))}
                  </div>
                </>
              ) : (
                <p className="mt-6 text-[13px] text-muted-foreground">No branches yet.</p>
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

const mapCard = 'flex flex-col gap-2 rounded-lg border border-border bg-paper p-3.5 text-left text-[13px] text-foreground transition-colors hover:border-input'
const currentCard = 'border-branch hover:border-branch'

/** A branch's card, with its own branches nested beneath on a thin rule. */
function MapBranch({ thread, state, narrow, onOpen }: {
  thread: Thread
  state: TreeState
  narrow: boolean
  onOpen: (threadId: string) => void
}) {
  const children = childThreads(state, thread.id)
  const takeaway = branchTakeaway(state, thread.id)
  const current = state.activeThreadId === thread.id
  return (
    <div className="flex min-w-0 flex-col">
      <button
        type="button"
        onClick={() => onOpen(thread.id)}
        className={cn(mapCard, narrow ? 'w-full' : 'w-[250px]', current && currentCard)}
        data-testid="map-card"
        data-thread-id={thread.id}
        aria-current={current ? 'true' : undefined}
      >
        <span className="flex items-center gap-2">
          {thread.unread ? <span className="size-[7px] shrink-0 rounded-full bg-branch" role="img" aria-label="New reply" /> : null}
          <span className="min-w-0 text-[14px] font-semibold">{threadTitle(thread)}</span>
        </span>
        {thread.anchor ? <span className="line-clamp-3 italic leading-snug text-muted-foreground">“{clipText(thread.anchor.quote, 180)}”</span> : null}
        {takeaway ? <span className="line-clamp-4 border-t border-border pt-2 leading-normal" data-testid="map-takeaway">{markdownToPlain(takeaway)}</span> : null}
      </button>
      {children.length > 0 ? (
        <div className="ml-3.5 flex flex-col gap-3 border-l border-border pl-3.5 pt-3">
          {children.map((child) => <MapBranch key={child.id} thread={child} state={state} narrow={narrow} onOpen={onOpen} />)}
        </div>
      ) : null}
    </div>
  )
}
