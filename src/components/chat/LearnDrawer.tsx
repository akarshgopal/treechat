import { useEffect, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { LoaderCircle, X } from 'lucide-react'
import { learnFileName, learnPrompt, type LearnScope } from '@/lib/learn'
import { requestAssistantText } from '@/lib/request-assistant'
import { downloadText } from '@/lib/transfer'
import type { TreeState } from '@/types'

/**
 * "What did I learn?": a Markdown summary of the chat (or of a branch and
 * what grew from it), streamed in read-only, then yours to edit, copy or save.
 */
export function LearnDrawer({ state, scope, onClose, onCopied }: {
  state: TreeState
  scope: LearnScope
  onClose: () => void
  onCopied: () => void
}) {
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  // What was there when the drawer opened: replies landing later must not restart it.
  const [snapshot] = useState(() => ({ state, scope }))
  const heading = `# ${snapshot.scope.title}\n\n`

  useEffect(() => {
    const abort = new AbortController()
    const run = async () => {
      setLoading(true)
      setError('')
      setContent('')
      try {
        const text = await requestAssistantText(learnPrompt(snapshot.state, snapshot.scope), undefined, undefined, abort.signal, {
          background: true,
          onText: (partial) => { if (!abort.signal.aborted) setContent(partial ? heading + partial : '') },
        })
        if (abort.signal.aborted) return
        if (!text) throw new Error('No summary was returned. Try again.')
        setContent(`${heading}${text}\n`)
      } catch (cause) {
        if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not write a summary.')
      } finally {
        if (!abort.signal.aborted) setLoading(false)
      }
    }
    void run()
    return () => abort.abort()
  }, [snapshot, attempt, heading])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      onCopied()
    } catch {
      setError('Could not copy. Select the text and copy it instead.')
    }
  }

  return (
    <DialogPrimitive.Root open onOpenChange={(value) => { if (!value) onClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/55 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[620px] flex-col border-l border-border bg-paper shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right-8"
          data-testid="learn-drawer"
        >
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border pl-5 pr-3">
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
              What did I learn?
              {/* Whole chat on the main thread; otherwise the open branch and what grew from it. */}
              <span className="ml-2 font-normal text-muted-foreground" data-testid="learn-scope">{snapshot.scope.title}</span>
            </DialogPrimitive.Title>
            <DialogPrimitive.Close className="icon-button" aria-label="Close" title="Close · Esc">
              <X size={16} />
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">A summary of {snapshot.scope.title}, as Markdown.</DialogPrimitive.Description>
          <div className="flex min-h-0 flex-1 flex-col gap-2 px-5 py-4">
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <label htmlFor="learn-text" className="sr-only">Your summary</label>
            <textarea
              id="learn-text"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              readOnly={loading}
              aria-busy={loading}
              placeholder={loading ? 'Summarizing…' : 'Write what you learned…'}
              className="min-h-0 flex-1 resize-none rounded-lg border border-input bg-background p-3 font-mono text-[13px] leading-relaxed text-foreground outline-none focus-visible:border-foreground/30"
              data-testid="learn-text"
            />
            {loading ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
                <LoaderCircle className="animate-spin" size={13} /> Summarizing — you can edit it when it’s done.
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 px-5 pb-5">
            {error && !loading ? <button type="button" className="btn btn-outline" onClick={() => setAttempt((value) => value + 1)}>Try again</button> : null}
            <button type="button" className="btn btn-outline" disabled={loading || !content.trim()} onClick={() => void copy()} data-testid="learn-copy">Copy</button>
            <button type="button" className="btn btn-outline" disabled={loading || !content.trim()} onClick={() => downloadText(learnFileName(snapshot.scope.title), content, 'text/markdown')} data-testid="learn-download">Download .md</button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
