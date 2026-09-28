import { useDeferredValue, useMemo, useState } from 'react'
import { exploredMatches, type ExploredMatch, type ExploredPassage } from '@/lib/explored'
import { useTree } from '@/store/tree-store'

/**
 * Branches about what is being asked, found as the person types (and, for a
 * selected passage, straight away). Dismissed ones stay hidden while this
 * composer or question box is open.
 */
export function useExplored({ text, passage, excludeThreadIds }: {
  text: string
  passage?: ExploredPassage
  excludeThreadIds?: readonly string[]
}) {
  const { sessions, activeSessionId, openThread } = useTree()
  const deferred = useDeferredValue(text)
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set())
  const excludeKey = excludeThreadIds?.join(',') ?? ''
  const matches = useMemo(
    () => exploredMatches(sessions, { text: deferred, passage, sessionId: activeSessionId, excludeThreadIds: excludeKey ? excludeKey.split(',') : [] })
      .filter((match) => !dismissed.has(match.threadId)),
    [sessions, deferred, passage, activeSessionId, excludeKey, dismissed],
  )
  return {
    matches,
    open: (match: ExploredMatch) => openThread(match.sessionId, match.threadId),
    dismiss: (match: ExploredMatch) => setDismissed((current) => new Set([...current, match.threadId])),
  }
}
