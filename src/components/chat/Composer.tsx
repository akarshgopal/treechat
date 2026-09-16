import {
  forwardRef,
  useCallback,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { CornerDownLeft, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type ComposerProps = {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop?: () => void
  isLoading?: boolean
  placeholder?: string
  banner?: ReactNode
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
      banner,
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
      <form onSubmit={onSubmit} className={cn('space-y-2', className)}>
        {banner}
        <div className="relative rounded-xl border border-border bg-paper shadow-sm focus-within:ring-1 focus-within:ring-ring">
          <Textarea
            ref={ref}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            onFocus={onFocus}
            placeholder={placeholder}
            disabled={disabled}
            rows={2}
            className="min-h-[72px] resize-none border-0 bg-transparent pr-24 shadow-none focus-visible:ring-0"
          />
          <div className="absolute bottom-2 right-2 flex items-center gap-1">
            {isLoading ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={onStop}
              >
                <Square className="size-3 fill-current" />
                Stop
              </Button>
            ) : (
              <Button type="submit" size="sm" disabled={!value.trim() || disabled}>
                Send
                <CornerDownLeft className="size-3.5 opacity-70" />
              </Button>
            )}
          </div>
        </div>
      </form>
    )
  },
)
