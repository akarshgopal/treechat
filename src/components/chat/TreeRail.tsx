import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { childThreads, depthOf, subtreeSize } from '@/lib/tree'
import type { Thread, TreeState } from '@/types'

function flatten(state: TreeState, threadId: string): Thread[] {
  const thread = state.threads[threadId]
  if (!thread) return []
  return [thread, ...childThreads(state, threadId).flatMap((child) => flatten(state, child.id))]
}

/** One row per thread, recursing into children — the whole tree, any depth. */
function Row({
  thread,
  state,
  activeId,
  focusedId,
  rootTitle,
  last,
  onFocus,
  onPointerFocus,
}: {
  thread: Thread
  state: TreeState
  activeId: string
  focusedId: string
  rootTitle: string
  last: boolean
  onFocus: (threadId: string) => void
  onPointerFocus: (threadId: string) => void
}) {
  const children = childThreads(state, thread.id)
  const active = thread.id === activeId
  const isRoot = thread.parentId === null
  const depth = depthOf(state, thread.id)
  const label = isRoot ? rootTitle : (thread.anchor?.quote ?? 'branch')
  const count = subtreeSize(state, thread.id)

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex min-w-0 items-stretch">
        {!isRoot ? (
          <span aria-hidden className="relative ml-2.5 w-[10px] shrink-0">
            <span
              className={`absolute left-0 top-0 w-px ${
                last ? 'h-1/2' : 'h-full'
              } ${active ? 'bg-branch/45' : 'bg-foreground/18'}`}
            />
            <span
              className={`absolute left-0 top-1/2 h-px w-full ${
                active ? 'bg-branch/45' : 'bg-foreground/18'
              }`}
            />
          </span>
        ) : null}
        <button
          type="button"
          role="treeitem"
          aria-level={depth + 1}
          aria-selected={active}
          aria-current={active ? 'true' : undefined}
          data-depth={depth}
          data-thread-id={thread.id}
          tabIndex={thread.id === focusedId ? 0 : -1}
          onClick={() => onFocus(thread.id)}
          onFocus={() => onPointerFocus(thread.id)}
          title={isRoot ? label : `Depth ${depth} · ${label}`}
          className={`relative flex min-w-0 flex-1 items-center gap-2 rounded-[7px] px-2 py-[5px] text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-branch/70 ${
            active
              ? 'bg-branch/[0.16] text-foreground'
              : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground'
          }`}
        >
          {active ? (
            <span
              aria-hidden
              className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-branch accent-glow"
            />
          ) : null}
          <span
            className={`size-[8px] shrink-0 rounded-full ${
              active ? 'accent-glow bg-branch' : 'bg-foreground/35'
            }`}
          />
          {!isRoot ? (
            <span className="eyebrow w-3 shrink-0 text-center text-muted-foreground/70">
              {depth}
            </span>
          ) : null}
          <span
            className={`min-w-0 truncate text-[12px] leading-tight ${
              active ? 'font-medium text-foreground' : ''
            }`}
          >
            {label}
          </span>
          {count > 0 ? (
            <span className="eyebrow ml-auto shrink-0 text-muted-foreground">{count}</span>
          ) : null}
        </button>
      </div>
      {children.length > 0 ? (
        <div className={isRoot ? '' : 'ml-2.5'} role="group">
          {children.map((child, index) => (
            <Row
              key={child.id}
              thread={child}
              state={state}
              activeId={activeId}
              focusedId={focusedId}
              rootTitle={rootTitle}
              last={index === children.length - 1}
              onFocus={onFocus}
              onPointerFocus={onPointerFocus}
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
  const nodes = useMemo(
    () => (root ? flatten(state, root.id) : []),
    [root, state],
  )
  const [focusedId, setFocusedId] = useState(state.activeThreadId)

  useEffect(() => {
    setFocusedId(state.activeThreadId)
  }, [state.activeThreadId])

  if (!root) return null

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const index = nodes.findIndex((thread) => thread.id === focusedId)
    const current = index < 0 ? 0 : index
    let next = current
    if (event.key === 'ArrowDown') next = Math.min(nodes.length - 1, current + 1)
    else if (event.key === 'ArrowUp') next = Math.max(0, current - 1)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = nodes.length - 1
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const id = nodes[current]?.id
      if (id) onFocus(id)
      return
    } else {
      return
    }
    event.preventDefault()
    const id = nodes[next]?.id
    if (!id) return
    setFocusedId(id)
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-testid="tree-rail"] [data-thread-id="${id}"]`,
      )
      el?.focus()
    })
  }

  return (
    <nav
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3.5 py-3"
      aria-label="Conversation tree"
      data-testid="tree-rail"
      onKeyDown={onKeyDown}
    >
      <span className="eyebrow shrink-0 px-0.5 text-muted-foreground">tree</span>
      <div className="min-w-0" role="tree" aria-label="Threads">
        <Row
          thread={root}
          state={state}
          activeId={state.activeThreadId}
          focusedId={focusedId}
          rootTitle={rootTitle}
          last
          onFocus={onFocus}
          onPointerFocus={setFocusedId}
        />
      </div>
      <div className="mt-auto flex shrink-0 items-center gap-2 rounded-[7px] border border-dashed border-border/80 px-2.5 py-2">
        <span className="text-[12px] leading-none text-branch">+</span>
        <span className="eyebrow text-muted-foreground">select text to branch</span>
      </div>
    </nav>
  )
}
