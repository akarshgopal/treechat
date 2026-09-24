import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
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
  /** Phones: a sheet along the bottom, clear of the system selection menu. */
  sheet?: boolean
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
  sheet = false,
}: BranchPopoverProps) {
  const [question, setQuestion] = useState(initialQuestion)
  const [position, setPosition] = useState(anchor)
  const input = useRef<HTMLTextAreaElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [measured, setMeasured] = useState({ width: 0, height: 0 })
  useAutosize(input, question, 140)

  // Clamp by the real width so the bar never runs off a narrow screen.
  useLayoutEffect(() => {
    if (box.current) setMeasured({ width: box.current.offsetWidth, height: box.current.offsetHeight })
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

  // The question box opens where the lens bar was and grows away from the
  // passage, so it never jumps to the other side of it.
  const width = mode === 'ask' ? Math.min(420, window.innerWidth - 24) : undefined
  const needed = measured.height || (mode === 'ask' ? 110 : 44)
  const roomAbove = position.top >= needed + 18
  const top = roomAbove ? Math.max(8, position.top - 10) : position.bottom + 10
  const half = (width ?? measured.width) / 2
  const left = Math.min(Math.max(position.left, half + 12), window.innerWidth - half - 12)

  const lensButtons = LENSES.map((lens) => (
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
  ))
  const lensRow = (
    <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto" role="group" aria-label="Quick questions">
      {lensButtons}
    </div>
  )

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    }
  }

  const askButton = (
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
  )

  const questionForm = (
    <form
      className="flex flex-col gap-1"
      aria-label="Ask about this passage"
      data-testid="branch-question"
      title={quote}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="flex items-end gap-1 rounded-lg border border-input bg-background/40 pl-3 focus-within:border-branch/60">
        <label className="sr-only" htmlFor="branch-question-input">Your branch question</label>
        <textarea
          id="branch-question-input"
          ref={input}
          rows={1}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about this passage…"
          className="min-h-10 flex-1 resize-none bg-transparent py-2.5 text-sm outline-none placeholder:text-muted-foreground"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <button type="submit" className="icon-button m-1 bg-foreground text-background hover:bg-foreground/85 hover:text-background" disabled={!question.trim()} aria-label="Send branch question" title="Send · Enter">
          <ArrowUp size={16} />
        </button>
      </div>
      <div className="flex min-w-0 items-center gap-1">
        {lensRow}
        <button type="button" onClick={onCancel} className="icon-button icon-button-sm ml-auto" aria-label="Cancel branch" title="Cancel · Esc">
          <X size={14} />
        </button>
      </div>
    </form>
  )

  if (sheet) {
    return createPortal(
      <div
        ref={box}
        className="branch-popover pointer-events-auto fixed inset-x-0 bottom-0 z-50 rounded-t-xl border-t border-branch/30 bg-paper px-2 pt-2 shadow-2xl"
        style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}
        data-testid="branch-popover"
        data-mode={mode}
        data-placement="sheet"
        data-branch-sheet
        onKeyDown={onKeyDown}
      >
        {mode === 'lenses' ? (
          <div className="flex min-w-0 items-center gap-1">
            {lensRow}
            <span className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden />
            {askButton}
          </div>
        ) : questionForm}
      </div>,
      document.body,
    )
  }

  return createPortal(
    <div
      ref={box}
      className={cn(
        'branch-popover pointer-events-auto fixed z-50 -translate-x-1/2 rounded-xl border border-branch/30 bg-paper shadow-2xl',
        roomAbove && '-translate-y-full',
        mode === 'lenses' ? 'flex max-w-[calc(100vw-24px)] items-center gap-0.5 p-1' : 'p-1.5',
      )}
      style={{ top, left, width }}
      data-testid="branch-popover"
      data-mode={mode}
      data-placement={roomAbove ? 'above' : 'below'}
      onKeyDown={onKeyDown}
    >
      {mode === 'lenses' ? (
        <>
          {lensRow}
          <span className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden />
          {askButton}
        </>
      ) : questionForm}
    </div>,
    document.body,
  )
}
