import { useEffect, useState } from 'react'

/** Appears only until the first visible token arrives. */
export function ReplyProgress() {
  const [startedAt] = useState(() => Date.now())
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])
  return (
    <div role="status" className="flex items-center gap-2 py-2 text-xs text-muted-foreground" data-testid="reply-progress">
      <span className="size-1.5 animate-pulse rounded-full bg-branch" aria-hidden />
      <span>{seconds < 15 ? 'Waiting for response' : 'Still waiting for response'}</span>
      {seconds > 0 ? <span aria-hidden className="tabular-nums">· {seconds}s</span> : null}
    </div>
  )
}
