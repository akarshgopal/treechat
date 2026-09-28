import { X } from 'lucide-react'
import type { ExploredMatch } from '@/lib/explored'

/** One compact line per match: where it was, its takeaway, Open and ×. */
export function ExploredBefore({ matches, onOpen, onDismiss }: {
  matches: ExploredMatch[]
  onOpen: (match: ExploredMatch) => void
  onDismiss: (match: ExploredMatch) => void
}) {
  if (matches.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5" data-testid="explored-before">
      {matches.map((match) => (
        <div
          key={`${match.sessionId}:${match.threadId}`}
          className="flex min-w-0 items-center gap-2 rounded-lg border border-branch/25 bg-branch/[0.06] py-1 pl-3 pr-1 text-[13px]"
          data-testid="explored-match"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-muted-foreground">
              Explored before: <b className="font-medium text-foreground">{match.title}</b>
              <span className="ml-1.5 text-xs">{match.chatTitle ? `in “${match.chatTitle}”` : 'this chat'}</span>
            </span>
            {match.takeaway ? <span className="truncate text-xs text-muted-foreground" data-testid="explored-takeaway">{match.takeaway}</span> : null}
          </span>
          <button type="button" className="btn btn-outline h-7" onClick={() => onOpen(match)} data-testid="explored-open">Open</button>
          <button type="button" className="icon-button icon-button-sm" onClick={() => onDismiss(match)} aria-label="Dismiss" title="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
