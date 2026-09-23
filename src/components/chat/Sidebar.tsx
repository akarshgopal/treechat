import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { PanelLeftClose, PanelLeftOpen, Settings, SquarePen } from 'lucide-react'

const STORAGE_KEY = 'treechat:sidebar:v1'
const DEFAULT_WIDTH = 252
const MIN_WIDTH = 200
const MAX_WIDTH = 440
const STEP = 24

type Layout = { width: number; collapsed: boolean }

const clamp = (width: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)))

function loadLayout(): Layout {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Layout> | null
    return {
      width: typeof parsed?.width === 'number' ? clamp(parsed.width) : DEFAULT_WIDTH,
      collapsed: parsed?.collapsed === true,
    }
  } catch {
    return { width: DEFAULT_WIDTH, collapsed: false }
  }
}

function saveLayout(layout: Layout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
  } catch {
    // Layout is a per-browser convenience; losing it is harmless.
  }
}

const toggleLabel = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘\\' : 'Ctrl+\\'

const iconButton =
  'flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground'

/**
 * The desktop sidebar: new chat on top, the tree and chat list in the middle,
 * documents and settings at the bottom. It folds to an icon strip (Ctrl/⌘+\)
 * and its right edge resizes it.
 */
export function Sidebar({ tree, sessions, documents, onNewChat, onOpenSettings }: {
  tree: ReactNode
  sessions: ReactNode
  documents?: ReactNode
  onNewChat: () => void
  onOpenSettings: () => void
}) {
  const [layout, setLayout] = useState(loadLayout)
  const drag = useRef<{ x: number; width: number } | null>(null)

  const update = (next: Layout, persist = true) => {
    setLayout(next)
    if (persist) saveLayout(next)
  }
  const toggle = () => update({ ...layout, collapsed: !layout.collapsed })

  const toggleRef = useRef(toggle)
  useEffect(() => {
    toggleRef.current = toggle
  })
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '\\' || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return
      event.preventDefault()
      toggleRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const settingsButton = (expanded: boolean) => (
    <button
      type="button"
      onClick={onOpenSettings}
      aria-label="Settings"
      title="Settings"
      data-testid="settings-button"
      className={expanded
        ? 'flex w-full items-center gap-2 rounded-md px-2 py-[7px] text-left text-[12.5px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground'
        : iconButton}
    >
      <Settings className="size-4 shrink-0" />
      {expanded ? <span>Settings</span> : null}
    </button>
  )

  if (layout.collapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-rail py-2.5" data-testid="chat-sidebar" data-collapsed="true">
        <button type="button" className={iconButton} onClick={toggle} aria-label="Expand sidebar" aria-expanded={false} title={`Expand sidebar · ${toggleLabel()}`} data-testid="sidebar-toggle">
          <PanelLeftOpen className="size-4" />
        </button>
        <button type="button" className={iconButton} onClick={onNewChat} aria-label="New chat" title="New chat" data-testid="new-chat">
          <SquarePen className="size-4" />
        </button>
        <div className="flex-1" />
        {settingsButton(false)}
      </aside>
    )
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, width: layout.width }
    document.body.classList.add('col-resizing')
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current
    if (start) update({ ...layout, width: clamp(start.width + event.clientX - start.x) }, false)
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current
    if (!start) return
    drag.current = null
    document.body.classList.remove('col-resizing')
    update({ ...layout, width: clamp(start.width + event.clientX - start.x) })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight') update({ ...layout, width: clamp(layout.width + STEP) })
    else if (event.key === 'ArrowLeft') update({ ...layout, width: clamp(layout.width - STEP) })
    else return
    event.preventDefault()
  }

  return (
    <aside
      className="relative flex min-h-0 shrink-0 flex-col border-r border-border bg-rail"
      style={{ width: layout.width }}
      data-testid="chat-sidebar"
      data-collapsed="false"
    >
      <div className="flex shrink-0 items-center gap-1 px-2.5 pt-2.5">
        <button
          type="button"
          onClick={onNewChat}
          aria-label="New chat"
          title="New chat"
          data-testid="new-chat"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border px-2.5 py-[7px] text-[12.5px] font-medium text-foreground transition-colors hover:border-branch/50 hover:bg-branch/5"
        >
          <SquarePen className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">New chat</span>
        </button>
        <button type="button" className={iconButton} onClick={toggle} aria-label="Collapse sidebar" aria-expanded title={`Collapse sidebar · ${toggleLabel()}`} data-testid="sidebar-toggle">
          <PanelLeftClose className="size-4" />
        </button>
      </div>
      {tree}
      <div className="flex max-h-[42%] min-h-0 shrink-0 flex-col border-t border-border px-3.5 py-3">
        {sessions}
      </div>
      {documents ? <div className="flex max-h-[30%] min-h-0 shrink-0 flex-col border-t border-border px-3.5 py-2.5">{documents}</div> : null}
      <div className="shrink-0 border-t border-border p-2">{settingsButton(true)}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={layout.width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        data-testid="sidebar-resizer"
        className="group absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none outline-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => update({ ...layout, width: DEFAULT_WIDTH })}
        onKeyDown={onKeyDown}
      >
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-branch/40 group-focus-visible:bg-branch group-active:bg-branch" aria-hidden />
      </div>
    </aside>
  )
}
