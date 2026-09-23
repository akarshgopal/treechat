import { useEffect, useState } from 'react'
import { ArrowUpLeft, LoaderCircle } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { compactTranscript } from '@/lib/compaction'
import { requestAssistantText } from '@/lib/request-assistant'
import { branchForwardedProps, threadTitle } from '@/lib/tree'
import type { Thread, TreeState } from '@/types'

export function TakeawayDialog({ thread, state, onClose, onConfirm }: {
  thread: Thread
  state: TreeState
  onClose: () => void
  onConfirm: (content: string) => void
}) {
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  // Capture the exploration when the preview opens. Later transcript updates
  // must not restart generation or overwrite the user's edits.
  const [snapshot] = useState(() => ({ thread, state }))
  const parent = state.threads[thread.parentId ?? '']
  const destination = parent ? threadTitle(parent) : 'Parent conversation'

  useEffect(() => {
    const abort = new AbortController()
    const run = async () => {
      setLoading(true)
      setError('')
      try {
        const forwarded = branchForwardedProps(snapshot.state, snapshot.thread.id)
        const summary = await requestAssistantText(
          `Summarize this TreeChat side-thread for its parent conversation. Capture the useful conclusion and any important uncertainty in two to four sentences, no preamble. Transcript:\n${compactTranscript(snapshot.thread)}`,
          forwarded?.quote, forwarded?.context, abort.signal, { background: true },
        )
        if (!abort.signal.aborted) {
          if (!summary) throw new Error('No takeaway was returned. Try again or write your own.')
          setContent(summary)
        }
      } catch (cause) {
        if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not prepare a takeaway.')
      } finally {
        if (!abort.signal.aborted) setLoading(false)
      }
    }
    void run()
    return () => abort.abort()
  }, [snapshot, attempt])

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[90svh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-xl" data-testid="takeaway-dialog">
        <DialogHeader>
          <DialogTitle>Takeaway</DialogTitle>
          <DialogDescription>To {destination}</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
            <LoaderCircle className="animate-spin" size={17} /> Summarizing…
          </div>
        ) : (
          <div className="space-y-2">
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <label htmlFor="takeaway-text" className="sr-only">Your takeaway</label>
            <Textarea id="takeaway-text" value={content} onChange={(event) => setContent(event.target.value)} rows={5} className="mt-2 text-[15px] leading-relaxed" placeholder="Write a takeaway…" />
            {error ? <button type="button" className="branch-secondary" onClick={() => setAttempt((value) => value + 1)}>Try again</button> : null}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="branch-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="branch-primary" data-testid="confirm-takeaway" onClick={() => onConfirm(content.trim())} disabled={loading || !content.trim() || !parent}>
            Add takeaway <ArrowUpLeft size={16} />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
