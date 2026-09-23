import { useEffect, useRef, useState } from 'react'
import { ArrowUp, X } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { useAutosize } from '@/lib/use-autosize'

export function BranchQuestion({ quote, onSend, onCancel }: {
  quote: string
  onSend: (question: string) => void
  onCancel: () => void
}) {
  const [question, setQuestion] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  useAutosize(input, question, 150)
  useEffect(() => {
    input.current?.focus({ preventScroll: true })
    input.current?.scrollIntoView({ block: 'nearest' })
  }, [])

  const submit = () => {
    if (question.trim()) onSend(question.trim())
  }

  return (
    <form
      className="branch-question my-2 rounded-lg border border-branch/30 bg-paper px-3 pt-1 shadow-sm transition-colors focus-within:border-branch/60 sm:ml-4"
      data-testid="branch-question"
      aria-label="Ask about this passage"
      onSubmit={(event) => { event.preventDefault(); submit() }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          event.preventDefault()
          onCancel()
        }
      }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <blockquote className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={quote}>
          {quote}
        </blockquote>
        <button type="button" onClick={onCancel} className="branch-icon-button" aria-label="Cancel branch" title="Cancel · Esc">
          <X size={14} />
        </button>
      </div>
      <div className="flex items-end gap-2">
      <label className="sr-only" htmlFor="branch-question-input">Your branch question</label>
      <Textarea
        id="branch-question-input"
        ref={input}
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        placeholder="Ask about this passage…"
        rows={1}
        className="min-h-11 flex-1 resize-none border-0 bg-transparent px-0 py-2.5 text-[15px] shadow-none focus-visible:ring-0"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            submit()
          }
        }}
      />
        <button type="submit" className="branch-icon-button mb-1 text-branch-bright disabled:opacity-50" disabled={!question.trim()} aria-label="Send branch question" title="Send · Enter">
          <ArrowUp size={18} />
        </button>
      </div>
    </form>
  )
}
