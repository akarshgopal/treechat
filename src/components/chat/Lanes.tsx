import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { threadTitle } from '@/lib/tree'
import { cn } from '@/lib/utils'
import type { Thread } from '@/types'

/** What a lane needs from its container. */
export type LaneFrame = {
  /** Space above the branch so it starts level with its source passage. */
  leadOffset: number
  /** Folds the lane into a strip; null when it cannot fold. */
  onCollapse: (() => void) | null
}

/**
 * A lane after the deepest thread that is not a thread (a source being read).
 * Its content must carry `data-lane-id={id}`, a scroll area and a
 * `[data-lane-anchor]` head, like a thread lane, so it gets a connector and
 * a lead offset the same way.
 */
export type TrailingLane = {
  id: string
  title: string
  label: string
  testId: string
  /** The lane it opens from. */
  ownerId: string
  /** Where in the owner lane its connector starts. */
  selector: string
  render: (frame: LaneFrame) => ReactNode
}

type LanesProps = {
  /** Root first; each thread is the open branch of the one before it. */
  path: Thread[]
  renderLane: (thread: Thread, frame: LaneFrame) => ReactNode
  /** One lane at a time (phones): only the deepest thread is shown. */
  single: boolean
  /** Name for the root thread (the chat's title). */
  rootTitle: string
  trailing?: TrailingLane | null
  /** Threads with a reply streaming in: their connectors pulse. */
  busyIds?: ReadonlySet<string>
}

type LaneEntry = { id: string; title: string; thread?: Thread; trailing?: TrailingLane }

/** A connector: from somewhere in one lane to the head of another. */
type LaneLink = { from: string; to: string; selectors: string[] }

type Connector = {
  id: string
  d: string
  offscreen: boolean
  start: { x: number; y: number }
  /** Passage scrolled out of its lane: a pill at the lane's edge leads back to it. */
  jump?: { x: number; y: number; direction: 'up' | 'down'; laneId: string; selectors: string[] }
}

const MAIN_MIN = 360
const BRANCH_DEFAULT = 460
const BRANCH_MIN = 320
const BRANCH_MAX = 960
/** Lanes meet at a border; the resize handle overlaps it and takes no room. */
const GUTTER = 0
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
const NO_IDS: ReadonlySet<string> = new Set()

/** Ids that just stopped being busy, for a moment: "your branch is ready". */
function useJustFinished(busyIds: ReadonlySet<string>) {
  const [ready, setReady] = useState<ReadonlySet<string>>(NO_IDS)
  const previous = useRef(busyIds)
  useEffect(() => {
    const finished = [...previous.current].filter((id) => !busyIds.has(id))
    previous.current = busyIds
    if (finished.length === 0) return
    setReady((current) => new Set([...current, ...finished]))
    const timer = window.setTimeout(() => {
      setReady((current) => new Set([...current].filter((id) => !finished.includes(id))))
    }, 1600)
    return () => window.clearTimeout(timer)
  }, [busyIds])
  return ready
}

export function Lanes({ path, renderLane, single, rootTitle, trailing, busyIds = NO_IDS }: LanesProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const [defaultWidth, setDefaultWidth] = useState(loadDefaultWidth)
  const [widths, setWidths] = useState<Record<string, number>>({})
  /** Explicit fold state from the reader; otherwise folding follows the fit. */
  const [folds, setFolds] = useState<Record<string, boolean>>({})
  const fullCount = useFullLaneCount(scroller, defaultWidth)

  const entries: LaneEntry[] = [
    ...path.map((thread) => ({ id: thread.id, title: thread.parentId ? threadTitle(thread) : rootTitle, thread })),
    ...(trailing ? [{ id: trailing.id, title: trailing.title, trailing }] : []),
  ]
  const autoFolded = single ? 0 : Math.max(0, entries.length - fullCount)
  // The deepest lane is where the reader is; it never folds.
  const collapsed = (id: string, index: number) =>
    !single && index < entries.length - 1 && (folds[id] ?? index < autoFolded)
  const visible = single ? entries.slice(-1) : entries
  const fullIds = visible
    .filter((entry) => !collapsed(entry.id, entries.indexOf(entry)))
    .map((entry) => entry.id)

  const links = useMemo<LaneLink[]>(() => {
    if (single) return []
    const out = path.slice(1).map((child, index) => ({
      from: path[index]!.id,
      to: child.id,
      selectors: [
        `[data-mark-ids~="${CSS.escape(child.id)}"]`,
        `[data-message-id="${CSS.escape(child.anchor?.messageId ?? '')}"]`,
      ],
    }))
    if (trailing) out.push({ from: trailing.ownerId, to: trailing.id, selectors: [trailing.selector] })
    return out
  }, [path, single, trailing])
  const { connectors, offsets } = useLaneGeometry(track, links, fullIds)
  const ready = useJustFinished(busyIds)
  const deepest = entries.at(-1)?.id

  // Bring a newly opened lane into view; closing one needs no scroll.
  const lastDepth = useRef(entries.length)
  useLayoutEffect(() => {
    const grew = entries.length > lastDepth.current
    lastDepth.current = entries.length
    const el = scroller.current
    if (!el || single || !grew) return
    el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' })
  }, [deepest, entries.length, single])

  const setFold = useCallback((threadId: string, value: boolean) => {
    setFolds((current) => ({ ...current, [threadId]: value }))
    if (!value) {
      requestAnimationFrame(() =>
        track.current
          ?.querySelector(`[data-lane-section="${CSS.escape(threadId)}"]`)
          ?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' }),
      )
    }
  }, [])

  const resize = useCallback((threadId: string, width: number, remember: boolean) => {
    const next = clampWidth(width)
    setWidths((current) => ({ ...current, [threadId]: next }))
    if (remember) {
      setDefaultWidth(next)
      saveDefaultWidth(next)
    }
  }, [])

  const canFold = fullIds.length > 1
  const collapseLane = (threadId: string) => () => setFolds((current) => ({ ...current, [threadId]: true }))
  const firstFullId = fullIds[0]

  return (
    <div ref={scroller} className="lanes h-full overflow-x-auto overflow-y-hidden" data-testid="lanes">
      <div ref={track} className="relative flex h-full min-w-full">
        {visible.map((entry) => {
          const index = entries.indexOf(entry)
          const { thread, title } = entry
          if (collapsed(entry.id, index)) {
            return (
              <button
                key={entry.id}
                type="button"
                className="lane-strip group flex h-full shrink-0 flex-col items-center gap-3 border-r border-border py-4 text-muted-foreground hover:bg-branch/5 hover:text-foreground"
                style={{ width: STRIP_WIDTH }}
                onClick={() => setFold(entry.id, false)}
                aria-label={`Expand lane: ${title}`}
                title={`Expand ${title}`}
                aria-expanded={false}
                data-testid="lane-strip"
              >
                <span className="size-2 shrink-0 rounded-full bg-branch/70 group-hover:bg-branch" aria-hidden />
                <span className="lane-strip-label min-h-0 truncate text-xs">{title}</span>
              </button>
            )
          }
          const first = entry.id === firstFullId
          const width = widths[entry.id] ?? defaultWidth
          const frame: LaneFrame = {
            leadOffset: offsets[entry.id] ?? 0,
            onCollapse: canFold && index < entries.length - 1 ? collapseLane(entry.id) : null,
          }
          return (
            <Fragment key={entry.id}>
              {!first && !single ? (
                <ResizeGutter
                  label={title}
                  width={width}
                  onResize={(next, remember) => resize(entry.id, next, remember)}
                  onReset={() => resize(entry.id, BRANCH_DEFAULT, true)}
                />
              ) : null}
              <section
                aria-label={entry.trailing?.label ?? (thread?.parentId ? `Branch: ${title}` : 'Main conversation')}
                data-testid={entry.trailing?.testId ?? (thread?.parentId ? 'branch-lane' : 'main-lane')}
                data-lane-section={entry.id}
                className={cn(
                  'lane relative h-full min-w-0',
                  single ? 'w-full' : first ? 'flex-1' : 'shrink-0',
                  (entry.trailing || thread?.parentId) && !single && 'lane-branch border-l border-branch/25',
                  entry.id === deepest && !single && (entry.trailing || thread?.parentId) && 'lane-enter',
                )}
                style={single ? undefined : first ? { minWidth: MAIN_MIN } : { width }}
              >
                {entry.trailing ? entry.trailing.render(frame) : renderLane(thread!, frame)}
              </section>
            </Fragment>
          )
        })}
        {connectors.length > 0 ? (
          <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible" aria-hidden data-testid="lane-connectors">
            {connectors.map((connector) => (
              <g
                key={connector.id}
                data-connector-for={connector.id}
                data-state={busyIds.has(connector.id) ? 'busy' : ready.has(connector.id) ? 'ready' : undefined}
                className={cn(connector.offscreen && 'lane-connector-offscreen')}
              >
                <path d={connector.d} className="lane-connector" />
                <circle cx={connector.start.x} cy={connector.start.y} r={3} className="lane-connector-dot" />
              </g>
            ))}
          </svg>
        ) : null}
        {connectors.map((connector) => connector.jump ? (
          <button
            key={`jump-${connector.id}`}
            type="button"
            className="absolute z-20 flex h-7 -translate-x-full -translate-y-1/2 items-center gap-1 rounded-full border border-branch/30 bg-paper px-2.5 text-xs text-branch-bright shadow-lg hover:border-branch/60"
            style={{ left: connector.jump.x, top: connector.jump.y }}
            onClick={() => scrollToPassage(track.current, connector.jump!)}
            data-testid="lane-jump"
            title="Scroll to the passage this branch grew from"
          >
            {connector.jump.direction === 'up' ? '↑' : '↓'} Passage
          </button>
        ) : null)}
      </div>
    </div>
  )
}

/** Bring a branch's source passage back into the middle of its lane. */
function scrollToPassage(root: HTMLElement | null, jump: NonNullable<Connector['jump']>) {
  const lane = root?.querySelector<HTMLElement>(`[data-lane-id="${CSS.escape(jump.laneId)}"]`)
  const passage = jump.selectors.reduce<HTMLElement | null>((found, selector) => found ?? lane?.querySelector<HTMLElement>(selector) ?? null, null)
  passage?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

/**
 * The seam between two lanes: a zero-width slot whose handle straddles the
 * border and resizes the lane to its right. Drag, arrow keys, or
 * double-click to reset.
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
    <div className="relative z-20 h-full w-0 shrink-0">
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}`}
      aria-valuenow={Math.round(width)}
      aria-valuemin={BRANCH_MIN}
      aria-valuemax={BRANCH_MAX}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      className="lane-gutter group absolute inset-y-0 -left-1 w-2 cursor-col-resize touch-none outline-none"
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
    </div>
  )
}

/**
 * Measures, on scroll, resize and DOM changes (a streaming reply moves text):
 * - connectors: curves from each passage to the head of its branch;
 * - offsets: how far down each branch starts so its head sits level with the
 *   passage, for as long as the branch still fits in its lane.
 */
function useLaneGeometry(track: RefObject<HTMLDivElement | null>, links: LaneLink[], fullIds: string[]) {
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [offsets, setOffsets] = useState<Record<string, number>>({})
  const offsetsRef = useRef(offsets)
  useEffect(() => {
    offsetsRef.current = offsets
  }, [offsets])
  const key = `${links.map((link) => `${link.from}>${link.to}:${link.selectors.join(',')}`).join('|')}|${fullIds.join(',')}`

  useEffect(() => {
    const root = track.current
    const full = new Set(fullIds)
    if (!root || links.length === 0) return
    let frame = 0
    const measure = () => {
      frame = 0
      const origin = root.getBoundingClientRect()
      const lines: Connector[] = []
      const lead: Record<string, number> = {}
      for (const link of links) {
        if (!full.has(link.from) || !full.has(link.to)) continue
        const parentLane = root.querySelector<HTMLElement>(`[data-lane-id="${CSS.escape(link.from)}"]`)
        const childLane = root.querySelector<HTMLElement>(`[data-lane-id="${CSS.escape(link.to)}"]`)
        const viewport = parentLane?.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')
        const childViewport = childLane?.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')
        const childHead = childLane?.querySelector<HTMLElement>('[data-lane-anchor]')
        if (!parentLane || !childLane || !viewport || !childViewport || !childHead) continue
        // The first selector that matches: a passage, else its message.
        const passage = link.selectors.reduce<HTMLElement | null>(
          (found, selector) => found ?? parentLane.querySelector<HTMLElement>(selector),
          null,
        )
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
        const previous = offsetsRef.current[link.to] ?? 0
        const settled = Math.abs(target - previous) <= 1 ? previous : target
        lead[link.to] = settled

        const sx = lane.right - origin.left
        const ex = head.left - origin.left
        const ey = view.top - childViewport.scrollTop + headNatural + settled + head.height / 2 - origin.top
        const sy = y - origin.top
        const bend = Math.max(14, (ex - sx) * 0.9)
        if (y !== rawY) {
          // The passage is out of view: a line across the whole screen to the
          // lane's edge says nothing. A short stub marks the branch head, and
          // a pill in the parent lane points to where the passage went.
          const stub = Math.max(10, ex - sx - 4)
          lines.push({
            id: link.to,
            offscreen: true,
            start: { x: ex - stub, y: ey },
            d: `M ${ex - stub} ${ey} L ${ex} ${ey}`,
            jump: {
              x: sx - 12,
              y: (rawY < bounds.top ? bounds.top + 22 : bounds.bottom - 22) - origin.top,
              direction: rawY < bounds.top ? 'up' : 'down',
              laneId: link.from,
              selectors: link.selectors,
            },
          })
          continue
        }
        lines.push({
          id: link.to,
          offscreen: false,
          start: { x: sx, y: sy },
          d: `M ${sx} ${sy} C ${sx + bend} ${sy}, ${ex - bend} ${ey}, ${ex} ${ey}`,
        })
      }
      offsetsRef.current = lead
      setConnectors((current) =>
        current.length === lines.length && current.every((c, i) => c.d === lines[i]!.d && c.offscreen === lines[i]!.offscreen && c.jump?.y === lines[i]!.jump?.y)
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

  return links.length === 0 ? { connectors: [], offsets: {} } : { connectors, offsets }
}
