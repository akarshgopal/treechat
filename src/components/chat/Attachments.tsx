import { useEffect, useState } from 'react'
import { FileText, LoaderCircle, X } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { attachmentLabel } from '@/lib/attachments/parse'
import { getAttachment, type StoredAttachment } from '@/lib/attachments/store'
import { cn } from '@/lib/utils'
import type { Attachment } from '@/types'

/** Contents are immutable once stored, so one read per id per visit is enough. */
const cache = new Map<string, Promise<StoredAttachment | undefined>>()

function useStored(id: string) {
  const [stored, setStored] = useState<StoredAttachment | undefined | null>(null)
  useEffect(() => {
    let live = true
    if (!cache.has(id)) cache.set(id, getAttachment(id).catch(() => undefined))
    void cache.get(id)!.then((value) => {
      if (live) setStored(value)
    })
    return () => {
      live = false
    }
  }, [id])
  return stored
}

function Thumbnail({ attachment, className }: { attachment: Attachment; className?: string }) {
  const stored = useStored(attachment.id)
  if (attachment.kind === 'text') {
    return (
      <span className={cn('flex items-center gap-1.5 rounded-md border border-border bg-paper px-2 text-xs text-muted-foreground', className)}>
        <FileText className="size-3.5 shrink-0" />
        <span className="truncate">{attachment.name}</span>
      </span>
    )
  }
  if (stored === null) return <span className={cn('block animate-pulse rounded-md bg-foreground/10', className)} />
  if (!stored) {
    return <span className={cn('flex items-center justify-center rounded-md border border-dashed border-border text-[11px] text-muted-foreground', className)}>missing</span>
  }
  return <img src={stored.data} alt={stored.description ?? attachment.name} className={cn('rounded-md object-cover', className)} draggable={false} />
}

/** Files waiting in a composer: removable chips above the text field. */
export function ComposerAttachments({ attachments, onRemove, busy }: {
  attachments: Attachment[]
  onRemove: (id: string) => void
  busy?: boolean
}) {
  if (attachments.length === 0 && !busy) return null
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 pt-3" data-testid="composer-attachments">
      {attachments.map((attachment) => (
        <span key={attachment.id} className="group relative" title={attachmentLabel(attachment)} data-attachment-id={attachment.id}>
          <Thumbnail attachment={attachment} className={attachment.kind === 'image' ? 'size-14' : 'h-8 max-w-44'} />
          <button
            type="button"
            onClick={() => onRemove(attachment.id)}
            aria-label={`Remove ${attachment.name}`}
            className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-paper text-muted-foreground shadow hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {busy ? <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-label="Preparing attachments" /> : null}
    </div>
  )
}

/** Images and files sent with a message; an image opens full size. */
export function MessageAttachments({ attachments, alignEnd }: { attachments: Attachment[]; alignEnd?: boolean }) {
  const [open, setOpen] = useState<Attachment | null>(null)
  return (
    <>
      <div className={cn('flex max-w-[78%] flex-wrap gap-1.5', alignEnd && 'justify-end')} data-testid="message-attachments">
        {attachments.map((attachment) =>
          attachment.kind === 'image' ? (
            <button
              key={attachment.id}
              type="button"
              onClick={() => setOpen(attachment)}
              aria-label={`View ${attachment.name}`}
              title={attachmentLabel(attachment)}
              className="overflow-hidden rounded-md border border-border hover:border-input"
            >
              <Thumbnail attachment={attachment} className="max-h-40 max-w-60" />
            </button>
          ) : (
            <Thumbnail key={attachment.id} attachment={attachment} className="h-8 max-w-60" />
          ),
        )}
      </div>
      {open ? <ImageViewer attachment={open} onClose={() => setOpen(null)} /> : null}
    </>
  )
}

function ImageViewer({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  const stored = useStored(attachment.id)
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[92svh] w-[calc(100%-2rem)] max-w-5xl gap-3 overflow-y-auto" data-testid="image-viewer">
        <DialogTitle className="truncate text-sm">{attachmentLabel(attachment)}</DialogTitle>
        <DialogDescription className={stored?.description ? 'text-[13px]' : 'sr-only'}>
          {stored?.description ?? 'Attached image'}
        </DialogDescription>
        {stored ? <img src={stored.data} alt={stored.description ?? attachment.name} className="mx-auto max-h-[75svh] rounded-md object-contain" /> : null}
      </DialogContent>
    </Dialog>
  )
}
