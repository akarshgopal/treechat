import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Download, FileText, GitBranch, Globe, MessageSquare, Search, Settings, Sparkles, SquarePen, TriangleAlert, Upload } from 'lucide-react'
import { newIssueUrl } from '@/lib/links'
import { sortSessions } from '@/lib/sessions'
import { depthOf, threadTitle } from '@/lib/tree'
import { cn } from '@/lib/utils'
import type { ChatSession, TreeState } from '@/types'

type Command = {
  id: string
  label: string
  group: 'Actions' | 'Branches' | 'Chats'
  icon: ReactNode
  hint?: string
  run: () => void
}

type CommandPaletteProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessions: ChatSession[]
  activeSessionId: string
  state: TreeState
  activeThreadId: string
  onSwitchChat: (sessionId: string) => void
  onFocusThread: (threadId: string) => void
  onNewChat: () => void
  onToggleWebSearch: () => void
  webSearch: boolean
  onOpenDocuments: () => void
  onOpenSettings: () => void
  onShowDemo: () => void
  onExport: () => void
  onImport: () => void
}

/** Everything in one place, from the keyboard: Ctrl/⌘+K. */
export function CommandPalette(props: CommandPaletteProps) {
  return (
    <DialogPrimitive.Root open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[14vh] z-50 flex max-h-[70svh] w-[calc(100vw-24px)] max-w-lg -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-border bg-paper shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0"
          data-testid="command-palette"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">Commands</DialogPrimitive.Title>
          {/* Unmounted while closed, so each open starts from an empty query. */}
          <PaletteBody {...props} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function PaletteBody({
  onOpenChange,
  sessions,
  activeSessionId,
  state,
  activeThreadId,
  onSwitchChat,
  onFocusThread,
  onNewChat,
  onToggleWebSearch,
  webSearch,
  onOpenDocuments,
  onOpenSettings,
  onShowDemo,
  onExport,
  onImport,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)

  const commands = useMemo<Command[]>(() => {
    const actions: Command[] = [
      { id: 'new-chat', label: 'New chat', group: 'Actions', icon: <SquarePen size={15} />, run: onNewChat },
      { id: 'web-search', label: webSearch ? 'Stop searching the web here' : 'Search the web in this thread', group: 'Actions', icon: <Globe size={15} />, run: onToggleWebSearch },
      { id: 'documents', label: 'Documents', group: 'Actions', icon: <FileText size={15} />, run: onOpenDocuments },
      { id: 'settings', label: 'Settings', group: 'Actions', icon: <Settings size={15} />, run: onOpenSettings },
      { id: 'export', label: 'Export chats', group: 'Actions', icon: <Download size={15} />, run: onExport },
      { id: 'import', label: 'Import chats…', group: 'Actions', icon: <Upload size={15} />, run: onImport },
      { id: 'demo', label: 'Show the walkthrough in this chat', group: 'Actions', icon: <Sparkles size={15} />, run: onShowDemo },
      { id: 'report', label: 'Report a problem', group: 'Actions', icon: <TriangleAlert size={15} />, run: () => window.open(newIssueUrl(), '_blank', 'noopener') },
    ]
    const branches: Command[] = Object.values(state.threads)
      .filter((thread) => thread.parentId && thread.id !== activeThreadId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((thread) => ({
        id: `branch:${thread.id}`,
        label: threadTitle(thread),
        group: 'Branches',
        icon: <GitBranch size={15} />,
        hint: depthOf(state, thread.id) > 1 ? `depth ${depthOf(state, thread.id)}` : undefined,
        run: () => onFocusThread(thread.id),
      }))
    const chats: Command[] = sortSessions(sessions)
      .filter((session) => session.id !== activeSessionId)
      .map((session) => ({
        id: `chat:${session.id}`,
        label: session.title,
        group: 'Chats',
        icon: <MessageSquare size={15} />,
        run: () => onSwitchChat(session.id),
      }))
    return [...actions, ...branches, ...chats]
  }, [activeSessionId, activeThreadId, onExport, onFocusThread, onImport, onNewChat, onOpenDocuments, onOpenSettings, onShowDemo, onSwitchChat, onToggleWebSearch, sessions, state, webSearch])

  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = commands.filter((command) => words.every((word) => command.label.toLowerCase().includes(word)))
  const selected = Math.min(index, Math.max(0, matches.length - 1))

  const run = (command: Command | undefined) => {
    if (!command) return
    onOpenChange(false)
    command.run()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') setIndex(Math.min(matches.length - 1, selected + 1))
    else if (event.key === 'ArrowUp') setIndex(Math.max(0, selected - 1))
    else if (event.key === 'Enter') run(matches[selected])
    else return
    event.preventDefault()
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3.5">
        <Search size={15} className="shrink-0 text-muted-foreground" aria-hidden />
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setIndex(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="Search chats, branches and actions…"
          aria-label="Search commands"
          role="combobox"
          aria-expanded
          aria-controls="command-list"
          aria-activedescendant={matches[selected] ? `command-${selected}` : undefined}
          className="h-12 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          data-testid="command-input"
        />
      </div>
      <div id="command-list" role="listbox" aria-label="Commands" className="min-h-0 overflow-y-auto p-1.5">
        {matches.length === 0 ? <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">Nothing matches.</p> : null}
        {matches.map((command, position) => (
          <div key={command.id}>
            {command.group !== matches[position - 1]?.group ? (
              <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">{command.group}</p>
            ) : null}
            <div
              id={`command-${position}`}
              role="option"
              aria-selected={position === selected}
              onMouseMove={() => setIndex(position)}
              onClick={() => run(command)}
              className={cn(
                'flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-[13px]',
                position === selected ? 'bg-secondary text-foreground' : 'text-muted-foreground',
              )}
              data-testid="command-option"
            >
              <span className={cn('shrink-0', command.group === 'Branches' ? 'text-branch' : 'text-muted-foreground')}>{command.icon}</span>
              <span className="min-w-0 flex-1 truncate">{command.label}</span>
              {command.hint ? <span className="shrink-0 text-[11px] text-muted-foreground">{command.hint}</span> : null}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
