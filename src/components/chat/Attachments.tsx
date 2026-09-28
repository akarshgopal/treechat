import { useEffect, useState, type PointerEvent } from 'react'
import { FileText, LoaderCircle, X } from 'lucide-react'
import { regionFromDrag, regionQuote, type Point } from '@/lib/anchors'
import { threadTitle } from '@/lib/tree'
import type { ChipState } from '@/components/chat/shell-context'
import type { Thread } from '@/types'
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

/** A stored attachment, small: the image itself, or a file chip. */
export function AttachmentThumbnail({ attachment, className }: { attachment: Attachment; className?: string }) {
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
          <AttachmentThumbnail attachment={attachment} className={attachment.kind === 'image' ? 'size-14' : 'h-8 max-w-44'} />
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

/** Branching from a region of a message's images. */
export type ImageRegions = {
  threadId: string
  messageId: string
  /** Branches anchored to a region of one of these images. */
  branches: Thread[]
  onOpenBranch: (threadId: string) => void
  onAsk: (passage: ChipState) => void
}

/** Images and files sent with a message; an image opens full size, or a region of it branches. */
export function MessageAttachments({ attachments, alignEnd, regions }: { attachments: Attachment[]; alignEnd?: boolean; regions?: ImageRegions }) {
  const [open, setOpen] = useState<Attachment | null>(null)
  const [selecting, setSelecting] = useState(false)
  const hasImage = attachments.some((attachment) => attachment.kind === 'image')
  useEffect(() => {
    if (!selecting) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      setSelecting(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [selecting])
  return (
    <>
      <div className={cn('flex max-w-[78%] flex-wrap gap-1.5', alignEnd && 'justify-end')} data-testid="message-attachments">
        {attachments.map((attachment) => {
          if (attachment.kind !== 'image') return <AttachmentThumbnail key={attachment.id} attachment={attachment} className="h-8 max-w-60" />
          const marks = regions?.branches.filter((branch) => branch.anchor?.region?.attachmentId === attachment.id) ?? []
          return (
            <span key={attachment.id} className="relative block" data-attachment-id={attachment.id}>
              <button
                type="button"
                onClick={() => setOpen(attachment)}
                aria-label={`View ${attachment.name}`}
                title={attachmentLabel(attachment)}
                className="block overflow-hidden rounded-md border border-border hover:border-input"
              >
                <AttachmentThumbnail attachment={attachment} className="block max-h-40 max-w-60" />
              </button>
              {selecting && regions ? (
                <RegionPicker
                  onPick={(region, box) => {
                    setSelecting(false)
                    regions.onAsk({
                      threadId: regions.threadId,
                      messageId: regions.messageId,
                      start: 0,
                      end: 0,
                      quote: regionQuote(attachment.name),
                      top: box.top,
                      left: box.left + box.width / 2,
                      bottom: box.top + box.height,
                      range: null,
                      region: { attachmentId: attachment.id, name: attachment.name, ...region },
                    })
                  }}
                />
              ) : null}
              {marks.length > 0 && regions ? (
                <span className="absolute right-1 top-1 flex gap-0.5" role="group" aria-label="Branches from this image">
                  {marks.map((branch) => (
                    <button
                      key={branch.id}
                      type="button"
                      onClick={() => regions.onOpenBranch(branch.id)}
                      aria-label={`Open branch: ${threadTitle(branch)}`}
                      title={threadTitle(branch)}
                      className="flex size-5 items-center justify-center rounded-full border border-border bg-paper/90 text-branch hover:border-branch"
                      data-testid="region-branch"
                    >
                      <span className="margin-branch-dot" aria-hidden />
                    </button>
                  ))}
                </span>
              ) : null}
            </span>
          )
        })}
      </div>
      {hasImage && regions ? (
        <button
          type="button"
          className="-my-1 h-7 px-1.5 text-xs text-muted-foreground hover:text-foreground"
          aria-pressed={selecting}
          onClick={() => setSelecting((value) => !value)}
          data-testid="select-region"
        >
          {selecting ? 'Done' : 'Select a region'}
        </button>
      ) : null}
      {open ? <ImageViewer attachment={open} onClose={() => setOpen(null)} /> : null}
    </>
  )
}

/** Drag a rectangle over an image, with a pointer or a finger. */
function RegionPicker({ onPick }: { onPick: (region: { x: number; y: number; w: number; h: number }, box: DOMRect) => void }) {
  /** The image's bounds are taken when the drag starts; the drag is measured against them. */
  const [drag, setDrag] = useState<{ from: Point; to: Point; bounds: DOMRect } | null>(null)
  const point = (event: PointerEvent) => ({ x: event.clientX, y: event.clientY })
  const shown = drag ? regionFromDrag(drag.from, drag.to, drag.bounds) : null
  return (
    <span
      className="absolute inset-0 cursor-crosshair touch-none rounded-md bg-black/25 outline outline-2 -outline-offset-2 outline-dashed outline-white/80"
      data-testid="region-picker"
      aria-label="Drag over the image to select a region"
      role="application"
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        setDrag({ from: point(event), to: point(event), bounds: event.currentTarget.getBoundingClientRect() })
      }}
      onPointerMove={(event) => {
        if (drag) setDrag({ ...drag, to: point(event) })
      }}
      onPointerUp={(event) => {
        if (!drag) return
        const region = regionFromDrag(drag.from, point(event), drag.bounds)
        const rect = drag.bounds
        setDrag(null)
        if (!region) return
        onPick(region, new DOMRect(rect.left + region.x * rect.width, rect.top + region.y * rect.height, region.w * rect.width, region.h * rect.height))
      }}
      onPointerCancel={() => setDrag(null)}
    >
      {shown ? (
        <span
          className="absolute rounded-sm border-2 border-branch bg-branch/30"
          style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, width: `${shown.w * 100}%`, height: `${shown.h * 100}%` }}
        />
      ) : null}
    </span>
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
