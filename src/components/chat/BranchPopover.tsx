import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUp, X } from 'lucide-react'
import { LENSES, type Lens } from '@/lib/lenses'
import { selectionClientRect } from '@/lib/selection'
import { useAutosize } from '@/lib/use-autosize'
import { branchShortcutLabel, cn } from '@/lib/utils'

export type PopoverAnchor = { top: number; left: number; bottom: number }

type BranchPopoverProps = {
  /** Where the passage sits on screen when the popover opened. */
  anchor: PopoverAnchor
  /** The live passage, when there is one: the popover follows it on scroll. */
  range?: Range | null
  quote: string
  /** `lenses` floats over a live selection; `ask` holds a question being written. */
  mode: 'lenses' | 'ask'
  initialQuestion?: string
  onLens: (lens: Lens) => void
  onAsk: (question: string) => void
  onOpenAsk: () => void
  onCancel: () => void
  /** Pressing a lens must not collapse the selection it acts on. */
  onHold?: () => void
}

const HIGHLIGHT = 'pending-branch'

/**
 * Branching in one gesture, right at the passage: tap a lens, or type a
 * question in place. Nothing opens elsewhere on the page.
 */
export function BranchPopover({
  anchor,
  range,
  quote,
  mode,
  initialQuestion = '',
  onLens,
  onAsk,
  onOpenAsk,
  onCancel,
  onHold,
}: BranchPopoverProps) {
  const [question, setQuestion] = useState(initialQuestion)
  const [position, setPosition] = useState(anchor)
  const input = useRef<HTMLTextAreaElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [measured, setMeasured] = useState(0)
  useAutosize(input, question, 140)

  // Clamp by the real width so the bar never runs off a narrow screen.
  useLayoutEffect(() => {
    if (box.current) setMeasured(box.current.offsetWidth)
  }, [mode])

  // Follow the passage while the thread scrolls under an open question.
  const [seenAnchor, setSeenAnchor] = useState(anchor)
  if (seenAnchor !== anchor) {
    setSeenAnchor(anchor)
    setPosition(anchor)
  }
  useEffect(() => {
    if (!range) return
    let frame = 0
    const follow = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const rect = selectionClientRect(range)
        if (rect) setPosition(rect)
      })
    }
    window.addEventListener('scroll', follow, true)
    window.addEventListener('resize', follow)
    return () => {
      window.removeEventListener('scroll', follow, true)
      window.removeEventListener('resize', follow)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [range])

  // Focusing the question clears the page selection; paint the passage so
  // the reader still sees what they are asking about.
  useEffect(() => {
    if (mode !== 'ask' || !range || typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight === 'undefined') return
    CSS.highlights.set(HIGHLIGHT, new Highlight(range))
    return () => {
      CSS.highlights.delete(HIGHLIGHT)
    }
  }, [mode, range])

  useLayoutEffect(() => {
    if (mode !== 'ask') return
    const el = input.current
    if (!el) return
    el.focus({ preventScroll: true })
    el.selectionStart = el.selectionEnd = el.value.length
  }, [mode])

  const submit = () => {
    const text = question.trim()
    if (text) onAsk(text)
  }

  const width = mode === 'ask' ? Math.min(440, window.innerWidth - 24) : undefined
  const roomAbove = position.top >= (mode === 'ask' ? 190 : 60)
  const top = roomAbove ? Math.max(8, position.top - 10) : position.bottom + 10
  const half = (width ?? measured) / 2
  const left = Math.min(Math.max(position.left, half + 12), window.innerWidth - half - 12)

  const lensRow = (
    <div className={cn('flex items-center gap-0.5', mode === 'ask' ? 'flex-wrap' : 'overflow-x-auto')} role="group" aria-label="Quick questions">
      {LENSES.map((lens) => (
        <button
          key={lens.id}
          type="button"
          className="lens-button"
          data-lens={lens.id}
          onMouseDown={(event) => {
            if (mode === 'lenses') event.preventDefault()
            onHold?.()
          }}
          onClick={() => onLens(lens)}
        >
          {lens.label}
        </button>
      ))}
    </div>
  )

  return createPortal(
    <div
      ref={box}
      className={cn(
        'branch-popover pointer-events-auto fixed z-50 -translate-x-1/2 rounded-xl border border-branch/40 bg-paper shadow-2xl',
        roomAbove && '-translate-y-full',
        mode === 'lenses' ? 'flex max-w-[calc(100vw-24px)] items-center gap-1 p-1' : 'flex flex-col gap-2 p-3',
      )}
      style={{ top, left, width }}
      data-testid="branch-popover"
      data-mode={mode}
      data-placement={roomAbove ? 'above' : 'below'}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onCancel()
        }
      }}
    >
      {mode === 'lenses' ? (
        <>
          <span className="pl-1.5 text-[13px] text-branch" aria-hidden>↳</span>
          {lensRow}
          <span className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden />
          <button
            type="button"
            className="lens-button shrink-0 text-branch-bright"
            data-testid="branch-chip"
            aria-keyshortcuts="Control+Shift+B Meta+Shift+B"
            title={`Ask your own question · ${branchShortcutLabel()} or just start typing`}
            onMouseDown={(event) => {
              event.preventDefault()
              onHold?.()
            }}
            onClick={onOpenAsk}
          >
            Ask…
          </button>
        </>
      ) : (
        <form
          className="flex flex-col gap-2"
          aria-label="Ask about this passage"
          data-testid="branch-question"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <div className="flex min-w-0 items-start gap-2">
            <blockquote className="line-clamp-2 min-w-0 flex-1 border-l-2 border-branch/60 pl-2 text-xs italic text-muted-foreground" title={quote}>
              {quote}
            </blockquote>
            <button type="button" onClick={onCancel} className="branch-icon-button -mr-1 -mt-1 size-7 min-h-7" aria-label="Cancel branch" title="Cancel · Esc">
              <X size={14} />
            </button>
          </div>
          <div className="flex items-end gap-2 rounded-lg border border-input bg-background/40 pl-3 focus-within:border-branch/60">
            <label className="sr-only" htmlFor="branch-question-input">Your branch question</label>
            <textarea
              id="branch-question-input"
              ref={input}
              rows={1}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask about this passage…"
              className="min-h-10 flex-1 resize-none bg-transparent py-2.5 text-[14.5px] outline-none placeholder:text-muted-foreground"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  submit()
                }
              }}
            />
            <button type="submit" className="branch-icon-button m-0.5 text-branch-bright disabled:opacity-40" disabled={!question.trim()} aria-label="Send branch question" title="Send · Enter">
              <ArrowUp size={18} />
            </button>
          </div>
          {lensRow}
        </form>
      )}
    </div>,
    document.body,
  )
}
