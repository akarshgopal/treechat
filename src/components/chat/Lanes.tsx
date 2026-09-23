import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { threadTitle } from '@/lib/tree'
import { cn } from '@/lib/utils'
import type { Thread } from '@/types'

type LanesProps = {
  /** Root first; each thread is the open branch of the one before it. */
  path: Thread[]
  renderLane: (thread: Thread) => ReactNode
  /** One lane at a time (phones): only the deepest thread is shown. */
  single: boolean
  /** Name for the root thread (the chat's title). */
  rootTitle: string
  /** Return to a folded ancestor, closing the lanes after it. */
  onReturnTo: (threadId: string) => void
}

const MAIN_MIN = 520
const BRANCH_WIDTH = 460 + 28
const STRIP_WIDTH = 44

/** How many lanes fit side by side before ancestors fold into strips. */
function useFullLaneCount(scroller: RefObject<HTMLDivElement | null>) {
  const [count, setCount] = useState(2)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = () => {
      const room = el.clientWidth - MAIN_MIN
      setCount(Math.max(2, 1 + Math.floor(room / BRANCH_WIDTH)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [scroller])
  return count
}

type Connector = { id: string; d: string; offscreen: boolean; start: { x: number; y: number } }

/**
 * Downward is time, rightward is depth. Every thread on the open path gets a
 * full-height lane of its own, and a line ties each branch to the passage it
 * grew from, following both as they scroll.
 */
export function Lanes({ path, renderLane, single, rootTitle, onReturnTo }: LanesProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const fullCount = useFullLaneCount(scroller)
  // Ancestors beyond what fits fold into narrow strips on the left: the
  // reader keeps the path in view without the main text being cut off.
  const folded = single ? 0 : Math.max(0, path.length - fullCount)
  const connectors = useConnectors(track, single ? [] : path.slice(folded))
  const deepest = path.at(-1)?.id

  // Bring a newly opened branch into view; closing one needs no scroll.
  const lastDepth = useRef(path.length)
  useLayoutEffect(() => {
    const grew = path.length > lastDepth.current
    lastDepth.current = path.length
    const el = scroller.current
    if (!el || single || !grew) return
    el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' })
  }, [deepest, path.length, single])

  const lanes = single ? path.slice(-1) : path.slice(folded)
  const strips = single ? [] : path.slice(0, folded)

  return (
    <div ref={scroller} className="lanes h-full overflow-x-auto overflow-y-hidden" data-testid="lanes">
      <div ref={track} className="relative flex h-full min-w-full">
        {strips.map((thread) => {
          const title = thread.parentId ? threadTitle(thread) : rootTitle
          return (
            <button
              key={thread.id}
              type="button"
              className="lane-strip group flex h-full shrink-0 flex-col items-center gap-3 border-r border-border py-4 text-muted-foreground hover:bg-branch/5 hover:text-foreground"
              style={{ width: STRIP_WIDTH }}
              onClick={() => onReturnTo(thread.id)}
              aria-label={`Back to ${title}`}
              title={`Back to ${title}`}
              data-testid="lane-strip"
            >
              <span className="size-2 shrink-0 rounded-full bg-branch/70 group-hover:bg-branch" aria-hidden />
              <span className="lane-strip-label min-h-0 truncate text-xs">{title}</span>
            </button>
          )
        })}
        {lanes.map((thread, index) => (
          <section
            key={thread.id}
            aria-label={thread.parentId ? 'Branch' : 'Main conversation'}
            data-testid={thread.parentId ? 'branch-lane' : 'main-lane'}
            className={cn(
              'lane relative h-full min-w-0',
              single
                ? 'w-full'
                : thread.parentId
                  ? cn('lane-branch w-[min(460px,88vw)] shrink-0 border-l border-branch/25', index === 0 ? 'flex-1' : 'ml-7')
                  : 'lane-main min-w-[520px] flex-1',
              index === lanes.length - 1 && !single && thread.parentId && 'lane-enter',
            )}
          >
            {renderLane(thread)}
          </section>
        ))}
        {connectors.length > 0 ? (
          <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible" aria-hidden data-testid="lane-connectors">
            {connectors.map((connector) => (
              <g key={connector.id} data-connector-for={connector.id} className={cn(connector.offscreen && 'lane-connector-offscreen')}>
                <path d={connector.d} className="lane-connector" />
                <circle cx={connector.start.x} cy={connector.start.y} r={3} className="lane-connector-dot" />
              </g>
            ))}
          </svg>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Curves from each anchored passage to the head of its branch lane. Redrawn
 * on scroll, resize, and DOM changes (a streaming reply moves the passage).
 */
function useConnectors(track: RefObject<HTMLDivElement | null>, path: Thread[]): Connector[] {
  const [connectors, setConnectors] = useState<Connector[]>([])
  const key = path.map((thread) => thread.id).join('>')

  useEffect(() => {
    const root = track.current
    if (!root || path.length < 2) {
      setConnectors([])
      return
    }
    let frame = 0
    const measure = () => {
      frame = 0
      const origin = root.getBoundingClientRect()
      const next: Connector[] = []
      for (let i = 1; i < path.length; i += 1) {
        const parent = path[i - 1]!
        const child = path[i]!
        const parentLane = root.querySelector<HTMLElement>(`[data-lane-id="${CSS.escape(parent.id)}"]`)
        const childHead = root.querySelector<HTMLElement>(`[data-lane-id="${CSS.escape(child.id)}"] [data-lane-anchor]`)
        const viewport = parentLane?.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')
        if (!parentLane || !childHead || !viewport) continue
        const passage =
          parentLane.querySelector<HTMLElement>(`[data-mark-ids~="${CSS.escape(child.id)}"]`)
          ?? parentLane.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(child.anchor?.messageId ?? '')}"]`)
        if (!passage) continue
        const bounds = viewport.getBoundingClientRect()
        const lane = parentLane.getBoundingClientRect()
        const rects = passage.getClientRects()
        const mark = rects[0] ?? passage.getBoundingClientRect()
        const rawY = mark.top + mark.height / 2
        const y = Math.min(Math.max(rawY, bounds.top + 10), bounds.bottom - 10)
        const offscreen = y !== rawY
        const head = childHead.getBoundingClientRect()
        // Run in the gutter between lanes, never across the text: leave the
        // parent lane's edge level with the passage, then bend to the branch head.
        const sx = lane.right - origin.left
        const sy = y - origin.top
        const ex = head.left - origin.left
        const ey = head.top + head.height / 2 - origin.top
        const bend = Math.max(14, (ex - sx) * 0.9)
        next.push({
          id: child.id,
          offscreen,
          start: { x: sx, y: sy },
          d: `M ${sx} ${sy} C ${sx + bend} ${sy}, ${ex - bend} ${ey}, ${ex} ${ey}`,
        })
      }
      setConnectors((current) =>
        current.length === next.length && current.every((c, i) => c.d === next[i]!.d && c.offscreen === next[i]!.offscreen)
          ? current
          : next,
      )
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    schedule()
    root.addEventListener('scroll', schedule, true)
    root.parentElement?.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    const resize = new ResizeObserver(schedule)
    resize.observe(root)
    const mutations = new MutationObserver(schedule)
    mutations.observe(root, { childList: true, subtree: true, characterData: true })
    return () => {
      if (frame) cancelAnimationFrame(frame)
      root.removeEventListener('scroll', schedule, true)
      root.parentElement?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      resize.disconnect()
      mutations.disconnect()
    }
    // `key` captures the path; the threads' contents are tracked by the DOM observers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, track])

  return path.length < 2 ? [] : connectors
}
