import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { ArrowUp, Globe, Paperclip, Square } from 'lucide-react'
import { ComposerAttachments } from '@/components/chat/Attachments'
import { Textarea } from '@/components/ui/textarea'
import { useAutosize } from '@/lib/use-autosize'
import { cn } from '@/lib/utils'
import type { Attachment } from '@/types'

/** Accepted by the file picker; drops and pastes are sorted by content. */
const PICKER_ACCEPT = 'image/*,.txt,.md,.markdown,.csv,.json,.yaml,.yml,.log,.pdf,text/*'

export type ComposerAttach = {
  items: Attachment[]
  /** Files are being read and resized. */
  busy: boolean
  onAdd: (files: File[]) => void
  onRemove: (id: string) => void
}

export type ComposerWebSearch = { on: boolean; onToggle: () => void }

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
  /** Paste, drop, or pick files to send with the message. Omit to disable. */
  attach?: ComposerAttach
  /** A line above the field, e.g. a problem with the attachments. */
  notice?: ReactNode
  /** Whether replies search the web; omit to hide the switch. */
  webSearch?: ComposerWebSearch
}

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')

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
      attach,
      notice,
      webSearch,
    },
    ref,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const picker = useRef<HTMLInputElement>(null)
    const [dropping, setDropping] = useState(false)
    useAutosize(textareaRef, value, 180)
    useImperativeHandle(ref, () => textareaRef.current as HTMLTextAreaElement, [textareaRef])
    const attached = attach?.items.length ?? 0
    const canSend = (value.trim().length > 0 || attached > 0) && !attach?.busy
    const submit = useCallback(() => {
      if (!canSend || isLoading || disabled) return
      onSend()
    }, [canSend, disabled, isLoading, onSend])

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

    // A pasted screenshot arrives as a file; plain pasted text is left alone.
    const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = [...event.clipboardData.files]
      if (!attach || files.length === 0) return
      event.preventDefault()
      attach.onAdd(files)
    }

    // Handled here, the drop never reaches the app-wide Documents drop zone.
    const dropProps = attach
      ? {
          'data-attach-drop': '',
          onDragOver: (event: DragEvent) => {
            if (!hasFiles(event)) return
            event.preventDefault()
            setDropping(true)
          },
          onDragLeave: (event: DragEvent) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false)
          },
          onDrop: (event: DragEvent) => {
            if (!hasFiles(event)) return
            event.preventDefault()
            setDropping(false)
            attach.onAdd([...event.dataTransfer.files])
          },
        }
      : {}

    return (
      <form onSubmit={onSubmit} className={cn(className)}>
        {notice ? <div className="mb-2 text-xs text-muted-foreground" data-testid="composer-notice">{notice}</div> : null}
        <div className="flex items-end gap-[11px]">
          <div
            {...dropProps}
            className={cn(
              'flex flex-1 flex-col rounded-lg border bg-paper transition-colors',
              accent ? 'border-branch/25 focus-within:border-branch/50' : 'border-input focus-within:border-foreground/30',
              dropping && 'border-foreground/50 bg-foreground/[0.04]',
            )}
          >
            {attach ? <ComposerAttachments attachments={attach.items} busy={attach.busy} onRemove={attach.onRemove} /> : null}
            <div className="flex items-end">
              {attach ? (
                <>
                  <button
                    type="button"
                    onClick={() => picker.current?.click()}
                    aria-label="Attach images or files"
                    title="Attach · or paste / drop"
                    data-testid="composer-attach"
                    className="icon-button m-1.5 mr-0"
                  >
                    <Paperclip size={16} />
                  </button>
                  <input
                    ref={picker}
                    type="file"
                    multiple
                    accept={PICKER_ACCEPT}
                    className="hidden"
                    data-testid="composer-file-input"
                    onChange={(event) => {
                      const files = [...(event.target.files ?? [])]
                      event.target.value = ''
                      if (files.length > 0) attach.onAdd(files)
                    }}
                  />
                </>
              ) : null}
              {webSearch ? (
                <button
                  type="button"
                  onClick={webSearch.onToggle}
                  aria-pressed={webSearch.on}
                  aria-label="Search the web"
                  title={webSearch.on ? 'Replies search the web and cite sources · click to stop' : 'Search the web for replies here'}
                  data-testid="web-search-toggle"
                  className={cn('icon-button m-1.5 mx-0', !attach && 'ml-1.5')}
                >
                  <Globe size={16} />
                </button>
              ) : null}
              <Textarea
                ref={textareaRef}
                data-testid={testId}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
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
                  className="icon-button m-1.5"
                >
                  <Square className="size-2.5 fill-current" />
                </button>
              ) : canSend ? (
                <button
                  type="submit"
                  disabled={disabled}
                  aria-label="Send message"
                  title="Send · Enter"
                  className="icon-button m-1.5 bg-foreground text-background hover:bg-foreground/85 hover:text-background"
                >
                  <ArrowUp size={18} />
                </button>
              ) : null}
            </div>
          </div>
          {trailing}
        </div>
      </form>
    )
  },
)
