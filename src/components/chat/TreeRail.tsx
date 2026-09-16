import { childThreads, subtreeSize } from '@/lib/tree'
import type { Thread, TreeState } from '@/types'

/** One row per thread, recursing into children — the whole tree, any depth. */
function Row({
  thread,
  state,
  activeId,
  rootTitle,
  last,
  onFocus,
}: {
  thread: Thread
  state: TreeState
  activeId: string
  rootTitle: string
  last: boolean
  onFocus: (threadId: string) => void
}) {
  const children = childThreads(state, thread.id)
  const active = thread.id === activeId
  const isRoot = thread.parentId === null
  const label = isRoot ? rootTitle : (thread.anchor?.quote ?? 'branch')
  const count = subtreeSize(state, thread.id)

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex min-w-0 items-stretch">
        {!isRoot ? (
          <span aria-hidden className="relative ml-3 w-[11px] shrink-0">
            <span
              className={`absolute left-0 top-0 w-px bg-foreground/30 ${
                last ? 'h-1/2' : 'h-full'
              }`}
            />
            <span className="absolute left-0 top-1/2 h-px w-full bg-foreground/30" />
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => onFocus(thread.id)}
          title={label}
          className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-left transition-colors ${
            active ? 'bg-branch/[0.13]' : 'hover:bg-foreground/[0.07]'
          }`}
        >
          <span
            className={`size-[9px] shrink-0 rounded-full ${
              active ? 'accent-glow bg-branch' : 'bg-muted-foreground'
            }`}
          />
          <span
            className={`min-w-0 truncate text-[12px] leading-tight ${
              active ? 'font-medium text-foreground' : 'text-muted-foreground'
            }`}
          >
            {label}
          </span>
          {count > 0 ? (
            <span className="eyebrow shrink-0 text-muted-foreground">{count}</span>
          ) : null}
        </button>
      </div>
      {children.length > 0 ? (
        <div className={isRoot ? '' : 'ml-3'}>
          {children.map((child, index) => (
            <Row
              key={child.id}
              thread={child}
              state={state}
              activeId={activeId}
              rootTitle={rootTitle}
              last={index === children.length - 1}
              onFocus={onFocus}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function TreeRail({
  state,
  rootTitle,
  onFocus,
}: {
  state: TreeState
  rootTitle: string
  onFocus: (threadId: string) => void
}) {
  const root = state.threads[state.rootId]
  if (!root) return null
  return (
    <nav className="hidden w-[236px] shrink-0 flex-col gap-3.5 overflow-y-auto border-r border-border bg-foreground/[0.035] px-4 py-5 md:flex">
      <span className="eyebrow shrink-0 text-muted-foreground">tree</span>
      <div className="min-w-0">
        <Row
          thread={root}
          state={state}
          activeId={state.activeThreadId}
          rootTitle={rootTitle}
          last
          onFocus={onFocus}
        />
      </div>
      <div className="mt-auto flex shrink-0 items-center gap-2 rounded-[7px] border border-dashed border-border px-2.5 py-2">
        <span className="text-[12px] leading-none text-branch">+</span>
        <span className="eyebrow text-muted-foreground">
          select text to branch
        </span>
      </div>
    </nav>
  )
}
