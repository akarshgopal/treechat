import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowUpLeft, Check, FoldHorizontal, Pencil, Trash2 } from 'lucide-react'
import { Menu, type MenuItem } from '@/components/ui/menu'
import { threadTitle } from '@/lib/tree'
import type { Thread } from '@/types'

/**
 * Every lane has the same header: where you are on the left, the lane's one
 * main action, then a ⋯ menu for the rest.
 */
function LaneHeaderFrame({ children }: { children: ReactNode }) {
  return <div className="flex h-12 min-w-0 shrink-0 items-center gap-1 border-b border-border px-3">{children}</div>
}

const collapseItem = (onCollapse: () => void): MenuItem => ({
  label: 'Collapse lane',
  icon: <FoldHorizontal size={14} />,
  onSelect: onCollapse,
  testId: 'collapse-lane',
})

export function BranchHeader({ thread, onMerge, onDiscard, onReturn, onCollapse, summarized }: {
  thread: Thread
  onMerge: () => void
  onDiscard: () => void
  onReturn: () => void
  onCollapse: (() => void) | null
  summarized?: boolean
}) {
  const title = threadTitle(thread)
  const answered = thread.messages.some((message) => message.role === 'assistant' && message.content.trim())
  return (
    <LaneHeaderFrame>
      <button
        type="button"
        className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left text-[13px] text-muted-foreground hover:bg-secondary hover:text-foreground"
        onClick={onReturn}
        data-testid="back-to-spine"
        aria-label="Back to passage"
        title={`Back to passage: ${thread.anchor?.quote ?? ''}`}
      >
        <ArrowLeft size={15} className="shrink-0" />
        <span className="truncate">{title}</span>
      </button>
      {summarized ? <Check size={14} className="shrink-0 text-branch" aria-label="Takeaway shared" /> : null}
      {answered ? (
        <button type="button" className="btn btn-branch" onClick={onMerge} data-testid="drop-summary" title="Write a takeaway for the conversation this branch came from">
          <ArrowUpLeft size={15} /> Bring back
        </button>
      ) : null}
      <Menu
        label="Branch actions"
        testId="branch-menu"
        items={[
          ...(onCollapse ? [collapseItem(onCollapse)] : []),
          { label: 'Discard branch', icon: <Trash2 size={14} />, onSelect: onDiscard, destructive: true, testId: 'discard-branch' },
        ]}
      />
    </LaneHeaderFrame>
  )
}

export function MainHeader({ title, onRename, onDelete, onCollapse }: {
  title: string
  onRename: (title: string) => void
  onDelete: () => void
  onCollapse: (() => void) | null
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editing) input.current?.select()
  }, [editing])
  const commit = () => {
    setEditing(false)
    if (draft.trim() && draft.trim() !== title) onRename(draft.trim())
  }
  return (
    <LaneHeaderFrame>
      {editing ? (
        <input
          ref={input}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
            if (event.key === 'Escape') {
              event.stopPropagation()
              setEditing(false)
            }
          }}
          aria-label="Rename chat"
          data-testid="session-title-input"
          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-[13px] text-foreground outline-none focus-visible:border-foreground/30"
        />
      ) : (
        <h1
          className="min-w-0 flex-1 truncate px-1.5 text-[13px] font-medium text-foreground"
          title={title}
          data-testid="session-title"
          onDoubleClick={() => {
            setDraft(title)
            setEditing(true)
          }}
        >
          {title}
        </h1>
      )}
      <Menu
        label="Chat actions"
        testId="chat-menu"
        items={[
          { label: 'Rename chat', icon: <Pencil size={14} />, onSelect: () => { setDraft(title); window.setTimeout(() => setEditing(true), 0) }, testId: 'rename-chat' },
          ...(onCollapse ? [collapseItem(onCollapse)] : []),
          'separator',
          { label: 'Delete chat', icon: <Trash2 size={14} />, onSelect: onDelete, destructive: true, testId: 'delete-chat' },
        ]}
      />
    </LaneHeaderFrame>
  )
}
