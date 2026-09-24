import { useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import {
  loadExpandedIds,
  revealThreadInRail,
  saveExpandedIds,
  setsEqual,
  toggleExpandedId,
  visibleRailThreads,
} from '@/lib/rail-collapse'
import { childThreads, depthOf, threadTitle } from '@/lib/tree'
import { cn } from '@/lib/utils'
import type { Thread, TreeState } from '@/types'

/** One row per thread, recursing into children — the whole tree, any depth. */
function Row({
  thread,
  state,
  activeId,
  focusedId,
  rootTitle,
  last,
  expandedIds,
  busyIds,
  onFocus,
  onPointerFocus,
  onToggle,
}: {
  thread: Thread
  state: TreeState
  activeId: string
  focusedId: string
  rootTitle: string
  last: boolean
  expandedIds: ReadonlySet<string>
  busyIds: ReadonlySet<string>
  onFocus: (threadId: string) => void
  onPointerFocus: (threadId: string) => void
  onToggle: (threadId: string) => void
}) {
  const children = childThreads(state, thread.id)
  const active = thread.id === activeId
  const isRoot = thread.parentId === null
  const depth = depthOf(state, thread.id)
  const label = isRoot ? rootTitle : threadTitle(thread)
  const hasChildren = children.length > 0
  const open = hasChildren && expandedIds.has(thread.id)
  const summarized = !isRoot && Object.values(state.threads).some((entry) =>
    entry.messages.some((message) => message.sourceThreadId === thread.id))

  const onCaret = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onToggle(thread.id)
  }

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
        <div
          role="treeitem"
          aria-level={depth + 1}
          aria-selected={active}
          aria-expanded={hasChildren ? open : undefined}
          aria-current={active ? 'true' : undefined}
          data-depth={depth}
          data-thread-id={thread.id}
          data-expanded={hasChildren ? (open ? 'true' : 'false') : undefined}
          tabIndex={thread.id === focusedId ? 0 : -1}
          onClick={() => onFocus(thread.id)}
          onFocus={() => onPointerFocus(thread.id)}
          title={isRoot ? label : `Depth ${depth} · ${label}`}
          className={cn(
            'relative flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md pr-2 pl-1 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring',
            active
              ? 'bg-foreground/[0.07] text-foreground'
              : 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground',
          )}
        >
          {hasChildren ? (
            <button
              type="button"
              tabIndex={-1}
              aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
              data-testid="tree-caret"
              onClick={onCaret}
              className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            >
              <ChevronRight
                className={cn('size-3 transition-transform', open && 'rotate-90')}
              />
            </button>
          ) : (
            <span
              className="flex size-5 shrink-0 items-center justify-center"
              aria-hidden
            >
              <span
                className={`size-[8px] rounded-full ${
                  active ? 'accent-glow bg-branch' : 'bg-foreground/35'
                }`}
              />
            </span>
          )}
          <span
            className={cn(
              'min-w-0 truncate text-xs leading-tight',
              active && 'font-medium text-foreground',
            )}
          >
            {label}
          </span>
          {summarized ? (
            <Check className="ml-auto size-3 shrink-0 text-branch" aria-label="Takeaway brought back" />
          ) : null}
          {busyIds.has(thread.id) ? (
            <span
              className={cn('size-1.5 shrink-0 animate-pulse rounded-full bg-foreground/70', !summarized && 'ml-auto')}
              role="status"
              aria-label="Replying"
              title="Replying…"
              data-testid="thread-busy"
            />
          ) : null}
        </div>
      </div>
      {hasChildren && open ? (
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
              expandedIds={expandedIds}
              busyIds={busyIds}
              onFocus={onFocus}
              onPointerFocus={onPointerFocus}
              onToggle={onToggle}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

const NO_BUSY: ReadonlySet<string> = new Set()

/**
 * The open chat's branches, nested under its row in the chat list. The chat
 * row stands for the main thread, so the tree starts at its branches.
 */
export function TreeRail({
  state,
  sessionId,
  rootTitle,
  onFocus,
  busyIds = NO_BUSY,
}: {
  state: TreeState
  sessionId: string
  rootTitle: string
  onFocus: (threadId: string) => void
  /** Threads with a reply streaming in. */
  busyIds?: ReadonlySet<string>
}) {
  const root = state.threads[state.rootId]
  const [expandedIds, setExpandedIds] = useState(() => {
    const loaded = loadExpandedIds(
      sessionId,
      new Set(Object.keys(state.threads)),
      state.rootId,
    )
    return revealThreadInRail(state, loaded, state.activeThreadId)
  })
  const [focusedId, setFocusedId] = useState(state.activeThreadId)
  const [seenActiveId, setSeenActiveId] = useState(state.activeThreadId)

  if (seenActiveId !== state.activeThreadId) {
    setSeenActiveId(state.activeThreadId)
    setFocusedId(state.activeThreadId)
    const revealed = revealThreadInRail(state, expandedIds, state.activeThreadId)
    if (!setsEqual(revealed, expandedIds)) {
      setExpandedIds(revealed)
      saveExpandedIds(sessionId, revealed)
    }
  }

  const nodes = useMemo(
    // The root's branches are always listed: the chat row stands for the root.
    () => (root ? visibleRailThreads(state, new Set([...expandedIds, state.rootId])).filter((thread) => thread.id !== state.rootId) : []),
    [root, state, expandedIds],
  )
  const rowFocusId = nodes.some((thread) => thread.id === focusedId)
    ? focusedId
    : nodes.some((thread) => thread.id === state.activeThreadId)
      ? state.activeThreadId
      : (nodes[0]?.id ?? state.activeThreadId)

  if (!root) return null

  const onToggle = (threadId: string) => {
    setExpandedIds((current) => {
      const next = toggleExpandedId(current, threadId)
      saveExpandedIds(sessionId, next)
      return next
    })
  }

  const focusRow = (id: string) => {
    setFocusedId(id)
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-testid="tree-rail"] [data-thread-id="${id}"]`,
      )
      el?.focus()
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const index = nodes.findIndex((thread) => thread.id === rowFocusId)
    const current = index < 0 ? 0 : index
    const thread = nodes[current]
    let next = current

    if (event.key === 'ArrowDown') next = Math.min(nodes.length - 1, current + 1)
    else if (event.key === 'ArrowUp') next = Math.max(0, current - 1)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = nodes.length - 1
    else if (event.key === 'ArrowRight') {
      if (!thread) return
      const kids = childThreads(state, thread.id)
      if (kids.length === 0) return
      event.preventDefault()
      if (!expandedIds.has(thread.id)) {
        onToggle(thread.id)
        return
      }
      next = Math.min(nodes.length - 1, current + 1)
    } else if (event.key === 'ArrowLeft') {
      if (!thread) return
      const kids = childThreads(state, thread.id)
      if (expandedIds.has(thread.id) && kids.length > 0) {
        event.preventDefault()
        onToggle(thread.id)
        return
      }
      if (!thread.parentId) return
      const parentIndex = nodes.findIndex((item) => item.id === thread.parentId)
      if (parentIndex < 0) return
      event.preventDefault()
      focusRow(nodes[parentIndex].id)
      return
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const id = thread?.id
      if (id) onFocus(id)
      return
    } else {
      return
    }
    event.preventDefault()
    const id = nodes[next]?.id
    if (!id) return
    focusRow(id)
  }

  const branches = childThreads(state, root.id)
  if (branches.length === 0) return null

  return (
    <nav
      className="flex min-w-0 flex-col py-0.5 pl-1"
      aria-label="Branches"
      data-testid="tree-rail"
      onKeyDown={onKeyDown}
    >
      <div className="min-w-0" role="tree" aria-label="Branches">
        {branches.map((branch, index) => (
          <Row
            key={branch.id}
            thread={branch}
            state={state}
            activeId={state.activeThreadId}
            focusedId={rowFocusId}
            rootTitle={rootTitle}
            last={index === branches.length - 1}
            expandedIds={expandedIds}
            busyIds={busyIds}
            onFocus={onFocus}
            onPointerFocus={setFocusedId}
            onToggle={onToggle}
          />
        ))}
      </div>
    </nav>
  )
}
