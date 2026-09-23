import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { ArrowUp, Square } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { useAutosize } from '@/lib/use-autosize'
import { cn } from '@/lib/utils'

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
  /** Names the thread this composer posts to, for assistive tech. */
  destination?: string
  testId?: string
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
      destination,
      testId,
    },
    ref,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    useAutosize(textareaRef, value, 180)
    useImperativeHandle(ref, () => textareaRef.current as HTMLTextAreaElement, [textareaRef])
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
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
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
              ref={textareaRef}
              data-testid={testId}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={onKeyDown}
              onFocus={onFocus}
              placeholder={placeholder}
              aria-label={destination ? `Message to ${destination}` : placeholder}
              disabled={disabled}
              rows={1}
              className="min-h-[48px] resize-none border-0 bg-transparent px-3 py-3 text-[15px] leading-[1.5] shadow-none placeholder:text-muted-foreground focus-visible:ring-0"
            />
            {isLoading ? (
              <button
                type="button"
                onClick={onStop}
                data-testid="composer-stop"
                aria-label="Stop response"
                title="Stop · Esc"
                className="branch-icon-button m-1.5"
              >
                <Square className="size-2.5 fill-current" />
              </button>
            ) : value.trim() ? (
              <button
                type="submit"
                disabled={disabled}
                aria-label="Send message"
                title="Send · Enter"
                className="branch-icon-button m-1.5 text-branch-bright disabled:opacity-50"
              >
                <ArrowUp size={18} />
              </button>
            ) : null}
          </div>
          {trailing}
        </div>
      </form>
    )
  },
)
