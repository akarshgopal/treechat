import { useLayoutEffect, useRef, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { threadTitle } from '@/lib/tree'
import { cn } from '@/lib/utils'
import type { Thread } from '@/types'

/** Ids only: titles are read fresh from `branches` on every render. */
type Line = { top: number; height: number; ids: string[] }

/** Marks on the same line (within a few pixels) share one marker. */
const SAME_LINE = 6

/**
 * Branches off a message, shown in the left margin level with the line each
 * one grew from: a dot for one, a count for several. The passage itself keeps
 * its underline; the margin says "something lives here" without a row of
 * links under every message.
 */
export function MarginBranches({ branches, openId, onOpen }: {
  /** Rendered inside the positioned wrapper around the message. */
  branches: Thread[]
  openId: string | null
  onOpen: (threadId: string | null) => void
}) {
  const [lines, setLines] = useState<Line[]>([])
  // Its own element, not a ref from the wrapper: a parent's ref is not yet
  // attached when a child's layout effect first runs.
  const group = useRef<HTMLDivElement>(null)
  const key = branches.map((branch) => branch.id).join(',')
  const branchesRef = useRef(branches)
  useLayoutEffect(() => {
    branchesRef.current = branches
  })

  useLayoutEffect(() => {
    const root = group.current?.parentElement
    if (!root) return
    const measure = () => {
      const origin = root.getBoundingClientRect()
      const found: Line[] = []
      for (const branch of branchesRef.current) {
        const mark = root.querySelector<HTMLElement>(`[data-mark-ids~="${CSS.escape(branch.id)}"]`)
        const rect = mark?.getClientRects()[0]
        const top = rect ? rect.top - origin.top : 0
        const height = rect ? rect.height : 20
        const line = found.find((entry) => Math.abs(entry.top - top) < SAME_LINE)
        if (line) line.ids.push(branch.id)
        else found.push({ top, height, ids: [branch.id] })
      }
      setLines((current) =>
        current.length === found.length && current.every((line, index) =>
          line.top === found[index]!.top && line.ids.join() === found[index]!.ids.join())
          ? current
          : found,
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    return () => observer.disconnect()
  }, [key])

  return (
    <div ref={group} aria-label="Branches from this message" role="group">
      {lines.map((entry) => {
        const line = { ...entry, branches: entry.ids.flatMap((id) => branches.filter((branch) => branch.id === id)) }
        if (line.branches.length === 0) return null
        const open = line.branches.some((branch) => branch.id === openId)
        const style = { top: line.top, height: Math.max(line.height, 20) }
        const marker = cn(
          'margin-branch absolute -left-6 flex w-5 items-center justify-center rounded-sm font-mono text-[11px] transition-colors',
          open ? 'text-branch-bright' : 'text-branch/80 hover:text-branch-bright',
        )
        if (line.branches.length === 1) {
          const branch = line.branches[0]!
          const isOpen = branch.id === openId
          return (
            <button
              key={branch.id}
              type="button"
              className={marker}
              style={style}
              data-open={isOpen}
              onClick={() => onOpen(isOpen ? null : branch.id)}
              aria-label={`${isOpen ? 'Close' : 'Open'} branch: ${threadTitle(branch)}`}
              aria-pressed={isOpen}
              title={threadTitle(branch)}
              data-testid="margin-branch"
            >
              <span className="margin-branch-dot" aria-hidden />
            </button>
          )
        }
        return (
          <DropdownMenu.Root key={line.branches[0]!.id} modal={false}>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className={marker}
                style={style}
                data-open={open}
                aria-label={`${line.branches.length} branches here`}
                data-testid="margin-branch"
              >
                {line.branches.length}
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content side="left" align="start" sideOffset={6} className="z-50 max-w-72 rounded-lg border border-border bg-paper p-1 shadow-xl">
                {line.branches.map((branch) => {
                  const isOpen = branch.id === openId
                  return (
                    <DropdownMenu.Item
                      key={branch.id}
                      onSelect={() => onOpen(isOpen ? null : branch.id)}
                      aria-label={`${isOpen ? 'Close' : 'Open'} branch: ${threadTitle(branch)}`}
                      className={cn(
                        'flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] outline-none data-[highlighted]:bg-secondary',
                        isOpen ? 'text-branch-bright' : 'text-foreground',
                      )}
                    >
                      <span className="truncate">{threadTitle(branch)}</span>
                    </DropdownMenu.Item>
                  )
                })}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )
      })}
    </div>
  )
}
