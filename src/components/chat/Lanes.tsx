import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { FoldHorizontal } from 'lucide-react'
import { threadTitle } from '@/lib/tree'
import { cn } from '@/lib/utils'
import type { Thread } from '@/types'

/** What a lane needs from its container. */
export type LaneFrame = {
  /** Space above the branch so it starts level with its source passage. */
  leadOffset: number
  /** Collapse control for the lane's header; null when it cannot fold. */
  controls: ReactNode
}

type LanesProps = {
  /** Root first; each thread is the open branch of the one before it. */
  path: Thread[]
  renderLane: (thread: Thread, frame: LaneFrame) => ReactNode
  /** One lane at a time (phones): only the deepest thread is shown. */
  single: boolean
  /** Name for the root thread (the chat's title). */
  rootTitle: string
}

type Connector = { id: string; d: string; offscreen: boolean; start: { x: number; y: number } }

const MAIN_MIN = 360
const BRANCH_DEFAULT = 460
const BRANCH_MIN = 320
const BRANCH_MAX = 960
const GUTTER = 28
const STRIP_WIDTH = 44
const RESIZE_STEP = 32
const WIDTH_KEY = 'treechat:lane-width:v1'

function loadDefaultWidth() {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(value) && value >= BRANCH_MIN ? Math.min(value, BRANCH_MAX) : BRANCH_DEFAULT
  } catch {
    return BRANCH_DEFAULT
  }
}

function saveDefaultWidth(width: number) {
  try {
    localStorage.setItem(WIDTH_KEY, String(Math.round(width)))
  } catch {
    // A remembered width is a convenience; losing it is harmless.
  }
}

const clampWidth = (width: number) => Math.min(BRANCH_MAX, Math.max(BRANCH_MIN, width))

/** How many lanes fit side by side before ancestors fold into strips. */
function useFullLaneCount(scroller: RefObject<HTMLDivElement | null>, branchWidth: number) {
  const [count, setCount] = useState(2)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = () => {
      const room = el.clientWidth - MAIN_MIN
      setCount(Math.max(2, 1 + Math.floor(room / (branchWidth + GUTTER))))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [scroller, branchWidth])
  return count
}

/**
 * Downward is time, rightward is depth. Every thread on the open path gets a
 * lane of its own; each branch starts level with the passage it grew from and
 * a line in the gutter ties the two together. Lanes fold into strips and the
 * gutters resize the lane to their right.
 */
export function Lanes({ path, renderLane, single, rootTitle }: LanesProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const [defaultWidth, setDefaultWidth] = useState(loadDefaultWidth)
  const [widths, setWidths] = useState<Record<string, number>>({})
  /** Explicit fold state from the reader; otherwise folding follows the fit. */
  const [folds, setFolds] = useState<Record<string, boolean>>({})
  const fullCount = useFullLaneCount(scroller, defaultWidth)

  const autoFolded = single ? 0 : Math.max(0, path.length - fullCount)
  // The deepest lane is where the reader is; it never folds.
  const collapsed = (thread: Thread, index: number) =>
    !single && index < path.length - 1 && (folds[thread.id] ?? index < autoFolded)
  const visible = single ? path.slice(-1) : path
  const fullIds = visible
    .filter((thread) => !collapsed(thread, path.indexOf(thread)))
    .map((thread) => thread.id)

  const { connectors, offsets } = useLaneGeometry(track, single ? [] : path, fullIds)
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

  const setFold = (threadId: string, value: boolean) => {
    setFolds((current) => ({ ...current, [threadId]: value }))
    if (!value) {
      requestAnimationFrame(() =>
        track.current
          ?.querySelector(`[data-lane-section="${CSS.escape(threadId)}"]`)
          ?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' }),
      )
    }
  }

  const resize = useCallback((threadId: string, width: number, remember: boolean) => {
    const next = clampWidth(width)
    setWidths((current) => ({ ...current, [threadId]: next }))
    if (remember) {
      setDefaultWidth(next)
      saveDefaultWidth(next)
    }
  }, [])

  const canFold = fullIds.length > 1
  const firstFullId = fullIds[0]

  return (
    <div ref={scroller} className="lanes h-full overflow-x-auto overflow-y-hidden" data-testid="lanes">
      <div ref={track} className="relative flex h-full min-w-full">
        {visible.map((thread) => {
          const index = path.indexOf(thread)
          const title = thread.parentId ? threadTitle(thread) : rootTitle
          if (collapsed(thread, index)) {
            return (
              <button
                key={thread.id}
                type="button"
                className="lane-strip group flex h-full shrink-0 flex-col items-center gap-3 border-r border-border py-4 text-muted-foreground hover:bg-branch/5 hover:text-foreground"
                style={{ width: STRIP_WIDTH }}
                onClick={() => setFold(thread.id, false)}
                aria-label={`Expand pane: ${title}`}
                title={`Expand ${title}`}
                aria-expanded={false}
                data-testid="lane-strip"
              >
                <span className="size-2 shrink-0 rounded-full bg-branch/70 group-hover:bg-branch" aria-hidden />
                <span className="lane-strip-label min-h-0 truncate text-xs">{title}</span>
              </button>
            )
          }
          const first = thread.id === firstFullId
          const width = widths[thread.id] ?? defaultWidth
          const frame: LaneFrame = {
            leadOffset: offsets[thread.id] ?? 0,
            controls: canFold && index < path.length - 1 ? (
              <button
                type="button"
                className="branch-icon-button"
                onClick={() => setFold(thread.id, true)}
                aria-label={`Collapse pane: ${title}`}
                title="Collapse pane"
                data-testid="collapse-lane"
              >
                <FoldHorizontal size={15} />
              </button>
            ) : null,
          }
          return (
            <Fragment key={thread.id}>
              {!first && !single ? (
                <ResizeGutter
                  label={title}
                  width={width}
                  onResize={(next, remember) => resize(thread.id, next, remember)}
                  onReset={() => resize(thread.id, BRANCH_DEFAULT, true)}
                />
              ) : null}
              <section
                aria-label={thread.parentId ? `Branch: ${title}` : 'Main conversation'}
                data-testid={thread.parentId ? 'branch-lane' : 'main-lane'}
                data-lane-section={thread.id}
                className={cn(
                  'lane relative h-full min-w-0',
                  single ? 'w-full' : first ? 'flex-1' : 'shrink-0',
                  thread.parentId && !single && 'lane-branch border-l border-branch/25',
                  thread.id === deepest && !single && thread.parentId && 'lane-enter',
                )}
                style={single ? undefined : first ? { minWidth: MAIN_MIN } : { width }}
              >
                {renderLane(thread, frame)}
              </section>
            </Fragment>
          )
        })}
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
 * The gap between two lanes: it carries the connector and resizes the lane
 * to its right. Drag, arrow keys, or double-click to reset.
 */
function ResizeGutter({ label, width, onResize, onReset }: {
  label: string
  width: number
  onResize: (width: number, remember: boolean) => void
  onReset: () => void
}) {
  const drag = useRef<{ x: number; width: number } | null>(null)

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, width }
    document.body.classList.add('col-resizing')
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current
    if (!start) return
    // Dragging the gutter left widens the lane on its right.
    onResize(start.width - (event.clientX - start.x), false)
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current
    if (!start) return
    drag.current = null
    document.body.classList.remove('col-resizing')
    onResize(start.width - (event.clientX - start.x), true)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') onResize(width + RESIZE_STEP, true)
    else if (event.key === 'ArrowRight') onResize(width - RESIZE_STEP, true)
    else if (event.key === 'Home') onResize(BRANCH_MAX, true)
    else if (event.key === 'End') onResize(BRANCH_MIN, true)
    else return
    event.preventDefault()
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}`}
      aria-valuenow={Math.round(width)}
      aria-valuemin={BRANCH_MIN}
      aria-valuemax={BRANCH_MAX}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      className="lane-gutter group relative h-full shrink-0 cursor-col-resize touch-none outline-none"
      style={{ width: GUTTER }}
      data-testid="lane-resizer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-branch/40 group-focus-visible:bg-branch group-active:bg-branch" aria-hidden />
    </div>
  )
}

/**
 * Measures, on scroll, resize and DOM changes (a streaming reply moves text):
 * - connectors: curves from each passage to the head of its branch;
 * - offsets: how far down each branch starts so its head sits level with the
 *   passage, for as long as the branch still fits in its lane.
 */
function useLaneGeometry(track: RefObject<HTMLDivElement | null>, path: Thread[], fullIds: string[]) {
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [offsets, setOffsets] = useState<Record<string, number>>({})
  const offsetsRef = useRef(offsets)
  useEffect(() => {
    offsetsRef.current = offsets
  }, [offsets])
  const key = `${path.map((thread) => thread.id).join('>')}|${fullIds.join(',')}`

  useEffect(() => {
    const root = track.current
    const full = new Set(fullIds)
    if (!root || path.length < 2) return
    let frame = 0
    const measure = () => {
      frame = 0
      const origin = root.getBoundingClientRect()
      const lines: Connector[] = []
      const lead: Record<string, number> = {}
      for (let i = 1; i < path.length; i += 1) {
        const parent = path[i - 1]!
        const child = path[i]!
        if (!full.has(parent.id) || !full.has(child.id)) continue
        const parentLane = root.querySelector<HTMLElement>(`[data-lane-id="${CSS.escape(parent.id)}"]`)
        const childLane = root.querySelector<HTMLElement>(`[data-lane-id="${CSS.escape(child.id)}"]`)
        const viewport = parentLane?.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')
        const childViewport = childLane?.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')
        const childHead = childLane?.querySelector<HTMLElement>('[data-lane-anchor]')
        if (!parentLane || !childLane || !viewport || !childViewport || !childHead) continue
        const passage =
          parentLane.querySelector<HTMLElement>(`[data-mark-ids~="${CSS.escape(child.id)}"]`)
          ?? parentLane.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(child.anchor?.messageId ?? '')}"]`)
        if (!passage) continue

        const bounds = viewport.getBoundingClientRect()
        const lane = parentLane.getBoundingClientRect()
        const mark = passage.getClientRects()[0] ?? passage.getBoundingClientRect()
        const rawY = mark.top + mark.height / 2
        const y = Math.min(Math.max(rawY, bounds.top + 10), bounds.bottom - 10)

        // Level the branch head with the passage while the whole branch fits
        // below it; as the branch grows it slides up so it stays readable.
        // Once the reader scrolls the branch, it keeps its own place.
        // Positions are taken net of the spacer's *rendered* height: it
        // animates, and a mid-transition read must not skew the target.
        const spacer = childLane.querySelector<HTMLElement>('.lane-lead')?.offsetHeight ?? 0
        const head = childHead.getBoundingClientRect()
        const view = childViewport.getBoundingClientRect()
        const headNatural = head.top - view.top + childViewport.scrollTop - spacer
        // The viewport's scrollHeight never drops below its own height; the
        // content box is the real measure of how tall the branch is.
        const inner = childViewport.firstElementChild as HTMLElement | null
        const content = (inner?.offsetHeight ?? childViewport.scrollHeight) - spacer
        const desired = Math.max(0, y - view.top - head.height / 2 - headNatural)
        const room = Math.max(0, childViewport.clientHeight - content)
        const target = childViewport.scrollTop > 1 ? 0 : Math.round(Math.min(desired, room))
        const previous = offsetsRef.current[child.id] ?? 0
        const settled = Math.abs(target - previous) <= 1 ? previous : target
        lead[child.id] = settled

        const sx = lane.right - origin.left
        const ex = head.left - origin.left
        const ey = view.top - childViewport.scrollTop + headNatural + settled + head.height / 2 - origin.top
        const sy = y - origin.top
        const bend = Math.max(14, (ex - sx) * 0.9)
        lines.push({
          id: child.id,
          offscreen: y !== rawY,
          start: { x: sx, y: sy },
          d: `M ${sx} ${sy} C ${sx + bend} ${sy}, ${ex - bend} ${ey}, ${ex} ${ey}`,
        })
      }
      offsetsRef.current = lead
      setConnectors((current) =>
        current.length === lines.length && current.every((c, i) => c.d === lines[i]!.d && c.offscreen === lines[i]!.offscreen)
          ? current
          : lines,
      )
      setOffsets((current) => {
        const ids = Object.keys(lead)
        return ids.length === Object.keys(current).length && ids.every((id) => current[id] === lead[id]) ? current : lead
      })
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
    root.querySelectorAll('[data-lane-section]').forEach((lane) => resize.observe(lane))
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
    // `key` captures the path and which lanes are open; contents are tracked
    // by the DOM observers above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, track])

  return path.length < 2 ? { connectors: [], offsets: {} } : { connectors, offsets }
}
