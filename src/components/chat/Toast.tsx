import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

/** `keepOpen`: the toast stays after this action (e.g. a "View" beside Undo). */
export type ToastAction = { label: string; onClick: () => void; keepOpen?: boolean }

export type ToastState = {
  /** A new id restarts the timer, even with the same text. */
  id: string
  text: string
  actions: ToastAction[]
}

/**
 * A short confirmation with Undo, instead of an "are you sure?" dialog. It
 * leaves on its own; hovering or focusing it holds it so Undo stays reachable.
 */
export function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (held) return
    const timer = window.setTimeout(onDismiss, 8_000)
    return () => window.clearTimeout(timer)
  }, [held, onDismiss, toast.id])
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-3">
      <div
        key={toast.id}
        className="rise pointer-events-auto flex max-w-full items-center gap-1 rounded-lg border border-border bg-paper py-1 pl-3.5 pr-1 text-[13px] text-foreground shadow-xl"
        role="status"
        data-testid="toast"
        onMouseEnter={() => setHeld(true)}
        onMouseLeave={() => setHeld(false)}
        onFocus={() => setHeld(true)}
        onBlur={() => setHeld(false)}
      >
        <span className="mr-2 min-w-0 truncate">{toast.text}</span>
        {toast.actions.map((action) => (
          <button
            key={action.label}
            type="button"
            className="btn text-foreground"
            onClick={() => {
              action.onClick()
              if (!action.keepOpen) onDismiss()
            }}
          >
            {action.label}
          </button>
        ))}
        <button type="button" className="icon-button icon-button-sm" aria-label="Dismiss" onClick={onDismiss}>
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
