import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { sortSessions } from '@/lib/sessions'
import { cn } from '@/lib/utils'
import type { ChatSession } from '@/types'

const fieldClass =
  'h-7 w-full rounded-md border border-input bg-transparent px-2 text-xs text-foreground shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring'

type SessionListProps = {
  sessions: ChatSession[]
  activeSessionId: string
  onSelect: (sessionId: string) => void
  onRename: (sessionId: string, title: string) => void
  onDelete: (sessionId: string) => void
  /** Show rename/delete without hover — used in the mobile dialog. */
  alwaysShowActions?: boolean
  /** Shown under the open chat: its branches. */
  activeTree?: ReactNode
}

export function SessionList({
  sessions,
  activeSessionId,
  onSelect,
  onRename,
  onDelete,
  alwaysShowActions = false,
  activeTree,
}: SessionListProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const ordered = sortSessions(sessions)

  useEffect(() => {
    if (!editingId) return
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [editingId])

  const beginRename = (session: ChatSession) => {
    setEditingId(session.id)
    setDraft(session.title)
  }

  const commitRename = (sessionId: string) => {
    const next = draft.trim()
    setEditingId(null)
    if (next) onRename(sessionId, next)
  }

  const onEditKey = (event: KeyboardEvent<HTMLInputElement>, sessionId: string) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitRename(sessionId)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setEditingId(null)
    }
  }

  const onEditSubmit = (event: FormEvent, sessionId: string) => {
    event.preventDefault()
    commitRename(sessionId)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="session-list">
      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto pb-2">
        {ordered.map((session) => {
          const active = session.id === activeSessionId
          const editing = session.id === editingId
          return (
            <div key={session.id} className="flex min-w-0 flex-col">
            <div
              data-testid="session-row"
              data-session-id={session.id}
              data-active={active ? 'true' : 'false'}
              className={cn(
                'group relative flex min-w-0 items-center gap-0.5 rounded-md',
                active ? 'bg-foreground/[0.07]' : 'hover:bg-foreground/[0.05]',
              )}
            >
              {editing ? (
                <form
                  className="min-w-0 flex-1 px-1 py-0.5"
                  onSubmit={(event) => onEditSubmit(event, session.id)}
                >
                  <input
                    ref={inputRef}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => commitRename(session.id)}
                    onKeyDown={(event) => onEditKey(event, session.id)}
                    aria-label="Rename chat"
                    data-testid="session-rename-input"
                    className={fieldClass}
                  />
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect(session.id)}
                  onDoubleClick={() => beginRename(session)}
                  title={session.title}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left',
                    active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'min-w-0 truncate text-[13px] leading-tight',
                      active ? 'font-medium text-foreground' : '',
                    )}
                  >
                    {session.title}
                  </span>
                </button>
              )}
              {editing ? null : (
                <div
                  className={cn(
                    'flex shrink-0 items-center pr-1',
                    alwaysShowActions
                      ? 'opacity-100'
                      : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
                  )}
                >
                  <button
                    type="button"
                    aria-label={`Rename ${session.title}`}
                    title="Rename"
                    data-testid="session-rename"
                    onClick={() => beginRename(session)}
                    className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${session.title}`}
                    title="Delete"
                    data-testid="session-delete"
                    onClick={() => onDelete(session.id)}
                    className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              )}
            </div>
            {active && activeTree ? activeTree : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
