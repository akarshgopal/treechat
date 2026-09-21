import {
  forwardRef,
  useCallback,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Square } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { cn, sendShortcutLabel } from '@/lib/utils'

type ComposerProps = {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop?: () => void
  isLoading?: boolean
  placeholder?: string
  /** Rendered to the right of the field — e.g. "Merge into main ↑". */
  trailing?: ReactNode
  /** Accent-tinted border, used by branch composers. */
  accent?: boolean
  disabled?: boolean
  onFocus?: () => void
  className?: string
}

export const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(
  function Composer(
    {
      value,
      onChange,
      onSend,
      onStop,
      isLoading,
      placeholder,
      trailing,
      accent,
      disabled,
      onFocus,
      className,
    },
    ref,
  ) {
    const submit = useCallback(() => {
      if (!value.trim() || isLoading || disabled) return
      onSend()
    }, [disabled, isLoading, onSend, value])

    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Escape' && isLoading) {
        event.preventDefault()
        event.stopPropagation()
        onStop?.()
        return
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        submit()
      }
    }

    const onSubmit = (event: FormEvent) => {
      event.preventDefault()
      submit()
    }

    return (
      <form onSubmit={onSubmit} className={cn(className)}>
        <div className="flex items-end gap-[11px]">
          <div
            className={cn(
              'flex flex-1 items-end rounded-lg border bg-paper transition-colors focus-within:border-branch/50',
              accent ? 'border-branch/25' : 'border-input',
            )}
          >
            <Textarea
              ref={ref}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={onKeyDown}
              onFocus={onFocus}
              placeholder={placeholder}
              disabled={disabled}
              rows={1}
              className="min-h-[42px] resize-none border-0 bg-transparent px-3 py-2.5 text-[13.5px] leading-[1.5] shadow-none placeholder:text-muted-foreground focus-visible:ring-0"
            />
            {isLoading ? (
              <button
                type="button"
                onClick={onStop}
                data-testid="composer-stop"
                className="m-2 flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[10.5px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <Square className="size-2.5 fill-current" />
                Stop
              </button>
            ) : value.trim() ? (
              <button
                type="submit"
                disabled={disabled}
                className="m-2 flex shrink-0 items-center gap-1.5 rounded-md border border-branch/30 bg-branch/15 px-2.5 py-1.5 text-[10.5px] font-medium text-branch-bright transition-colors hover:bg-branch/25 disabled:opacity-50"
              >
                Send ⏎
              </button>
            ) : (
              <span
                data-testid="send-shortcut-hint"
                className="m-2 shrink-0 select-none px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground"
              >
                {sendShortcutLabel()}
              </span>
            )}
          </div>
          {trailing}
        </div>
      </form>
    )
  },
)
