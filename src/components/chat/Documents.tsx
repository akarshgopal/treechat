import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { FileText, Plus, Trash2, Upload } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ACCEPTED_FILES } from '@/lib/documents/extract'
import {
  addDocumentFiles,
  dismissDocumentNotice,
  removeDocument,
  useDocumentLibrary,
  type DocumentLibrary,
} from '@/lib/documents/library'
import { DEFAULT_EMBEDDING_MODEL_MB } from '@/lib/documents/model-embedder'
import type { StoredDocument } from '@/lib/documents/types'
import { cn } from '@/lib/utils'
import { useTree } from '@/store/tree-store'

/**
 * Documents: a library shared by every chat, and per chat the ones it
 * searches. Everything here stays in this browser (IndexedDB); only matching
 * excerpts go to the model, with the question they answer.
 */

/** The active chat's attached documents, and a way to change them. */
function useChatDocuments() {
  const { activeSession, setSessionDocuments } = useTree()
  const attached = activeSession.documentIds ?? []
  return {
    attached,
    setAttached: (ids: string[]) => setSessionDocuments(activeSession.id, ids),
    attach: (ids: string[]) => setSessionDocuments(activeSession.id, [...attached, ...ids]),
  }
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatLabel(doc: StoredDocument) {
  return doc.format === 'pdf' ? 'PDF' : doc.format === 'markdown' ? 'Markdown' : 'Text'
}

/** What a row says under its name: progress while indexing, facts after. */
function statusLine(doc: StoredDocument, library: DocumentLibrary): { text: string; tone: 'muted' | 'busy' | 'warn' | 'error' } {
  const progress = library.progress[doc.id]
  if (progress || doc.status === 'indexing') {
    switch (progress?.stage) {
      case 'queued': return { text: 'Waiting…', tone: 'busy' }
      case 'model': {
        const percent = progress.total ? ` ${Math.round(((progress.loaded ?? 0) / progress.total) * 100)}%` : ''
        return { text: `Downloading search model (one time, ~${DEFAULT_EMBEDDING_MODEL_MB} MB)${percent}`, tone: 'busy' }
      }
      case 'embedding': return { text: `Indexing ${progress.done}/${progress.total}`, tone: 'busy' }
      default: return { text: 'Reading…', tone: 'busy' }
    }
  }
  if (doc.status === 'error') return { text: doc.error ?? 'Could not index this file.', tone: 'error' }
  const facts = [formatLabel(doc), doc.pages ? `${doc.pages} ${doc.pages === 1 ? 'page' : 'pages'}` : '', formatSize(doc.size)]
  if (doc.error) return { text: `${facts.filter(Boolean).join(' · ')} · keyword search only`, tone: 'warn' }
  return { text: facts.filter(Boolean).join(' · '), tone: 'muted' }
}

const toneClass = {
  muted: 'text-muted-foreground',
  busy: 'text-foreground',
  warn: 'text-amber-500',
  error: 'text-destructive',
}

/** Hidden file input plus the button that opens it. */
function AddFilesButton({ onAdded, compact = false }: { onAdded: (ids: string[]) => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? [...event.target.files] : []
    event.target.value = ''
    if (files.length > 0) onAdded(addDocumentFiles(files))
  }
  return (
    <>
      <input ref={input} type="file" multiple accept={ACCEPTED_FILES} className="hidden" onChange={onChange} data-testid="documents-file-input" />
      {compact ? (
        <button
          type="button"
          onClick={() => input.current?.click()}
          aria-label="Add documents"
          title="Add documents (PDF, Markdown, text)"
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      ) : (
        <button type="button" className="btn btn-outline" onClick={() => input.current?.click()} data-testid="documents-add">
          <Upload className="size-3.5" />
          Add files
        </button>
      )}
    </>
  )
}

function DocumentRow({ doc, library, checked, onToggle, onRemove }: {
  doc: StoredDocument
  library: DocumentLibrary
  checked: boolean
  onToggle: (checked: boolean) => void
  onRemove: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const status = statusLine(doc, library)
  const indexing = Boolean(library.progress[doc.id])
  return (
    <li
      className={cn('flex min-w-0 items-start gap-2.5 rounded-md px-2 py-2', checked ? 'bg-foreground/[0.06]' : 'hover:bg-foreground/[0.04]')}
      data-testid="document-row"
      data-document-id={doc.id}
      data-status={indexing ? 'indexing' : doc.status}
    >
      <input
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 accent-[var(--foreground)]"
        checked={checked}
        disabled={doc.status === 'error'}
        onChange={(event) => onToggle(event.target.checked)}
        aria-label={`Use ${doc.name} in this chat`}
        data-testid="document-attach"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-foreground" title={doc.name}>{doc.name}</div>
        <div className={cn('text-xs leading-snug', toneClass[status.tone])} title={doc.error}>{status.text}</div>
      </div>
      {confirming ? (
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" className="btn text-destructive hover:text-destructive" onClick={onRemove} data-testid="document-remove-confirm">
            Remove
          </button>
          <button type="button" className="btn" onClick={() => setConfirming(false)}>Keep</button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={indexing}
          aria-label={`Remove ${doc.name}`}
          title="Remove from all chats"
          data-testid="document-remove"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive disabled:opacity-40"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </li>
  )
}

/** The management dialog: add, attach to this chat, watch indexing, remove. */
export function DocumentsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const library = useDocumentLibrary()
  const { attached, setAttached, attach } = useChatDocuments()
  const { forgetDocument } = useTree()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85svh] max-w-md flex-col gap-4 sm:rounded-lg" data-testid="documents-dialog">
        <DialogHeader>
          <DialogTitle>Documents</DialogTitle>
          <DialogDescription>
            Checked documents are searched for this chat. Files stay in this browser; only
            matching excerpts are sent to the model with your question.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <AddFilesButton onAdded={attach} />
          <span className="text-xs text-muted-foreground">PDF, Markdown, or text — or drop files anywhere.</span>
        </div>
        {library.notice ? (
          <div className="flex items-start gap-2 rounded-md border border-border px-2.5 py-2 text-xs text-muted-foreground" role="status">
            <span className="flex-1">{library.notice}</span>
            <button type="button" className="text-[11px] underline-offset-2 hover:underline" onClick={dismissDocumentNotice}>Dismiss</button>
          </div>
        ) : null}
        {library.documents.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">
            No documents yet. Add a file to ask questions about it.
          </p>
        ) : (
          <ul className="-mx-2 flex min-h-0 flex-col gap-0.5 overflow-y-auto" data-testid="document-list">
            {library.documents.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                library={library}
                checked={attached.includes(doc.id)}
                onToggle={(checked) => setAttached(checked ? [...attached, doc.id] : attached.filter((id) => id !== doc.id))}
                onRemove={() => {
                  // The library is shared, so the document leaves every chat.
                  forgetDocument(doc.id)
                  void removeDocument(doc.id)
                }}
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Compact sidebar section: the library at a glance, attach in one click. */
export function DocumentsSidebarSection({ onOpen }: { onOpen: () => void }) {
  const library = useDocumentLibrary()
  const { attached, setAttached, attach } = useChatDocuments()
  const count = attached.filter((id) => library.documents.some((doc) => doc.id === id)).length
  return (
    <div className="flex min-h-0 flex-col gap-0.5" data-testid="documents-section" data-count={count}>
      <div className="flex items-center gap-1">
        <button type="button" onClick={onOpen} className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-[13px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground" data-testid="documents-open" title="Open the document library">
          <FileText className="size-4 shrink-0" />
          <span className="truncate">Documents</span>
          {library.documents.length > 0 ? <span className="ml-auto text-xs tabular-nums">{count}/{library.documents.length}</span> : null}
        </button>
        <AddFilesButton onAdded={attach} compact />
      </div>
      {library.documents.length === 0 ? (
        <button type="button" onClick={onOpen} className="rounded-md px-2 pb-1 text-left text-xs text-muted-foreground hover:text-foreground">
          Add files to ask about them
        </button>
      ) : (
        <ul className="flex max-h-28 min-h-0 flex-col gap-0.5 overflow-y-auto">
          {library.documents.map((doc) => {
            const busy = Boolean(library.progress[doc.id]) || doc.status === 'indexing'
            const checked = attached.includes(doc.id)
            return (
              <li key={doc.id}>
                <label className="flex h-7 min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground">
                  <input
                    type="checkbox"
                    className="size-3.5 shrink-0 accent-[var(--foreground)]"
                    checked={checked}
                    disabled={doc.status === 'error'}
                    onChange={(event) => setAttached(event.target.checked ? [...attached, doc.id] : attached.filter((id) => id !== doc.id))}
                    aria-label={`Use ${doc.name} in this chat`}
                  />
                  <span className={cn('min-w-0 flex-1 truncate', checked && 'text-foreground')} title={doc.name}>{doc.name}</span>
                  {busy ? <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-foreground" title="Indexing" /> : null}
                  {doc.status === 'error' ? <span className="size-1.5 shrink-0 rounded-full bg-destructive" title={doc.error} /> : null}
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Phone entry in the chats dialog (phones have no sidebar). */
export function DocumentsLibraryEntry({ onOpen }: { onOpen: () => void }) {
  const library = useDocumentLibrary()
  const { attached } = useChatDocuments()
  const count = attached.filter((id) => library.documents.some((doc) => doc.id === id)).length
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="documents-entry"
      data-count={count}
      className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5 text-left text-[13px] text-foreground transition-colors hover:bg-secondary"
    >
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex-1">Documents</span>
      <span className="text-xs text-muted-foreground">
        {library.documents.length === 0 ? 'Add files' : `${count} of ${library.documents.length} in this chat`}
      </span>
    </button>
  )
}

/**
 * Drop files anywhere on the app to add them and use them in this chat.
 * Only reacts to drags that carry files, so dragging text still works.
 */
export function DocumentDropZone({ onDropped }: { onDropped: () => void }) {
  const { attach } = useChatDocuments()
  const [active, setActive] = useState(false)
  const depth = useRef(0)
  const attachRef = useRef(attach)
  const droppedRef = useRef(onDropped)
  useEffect(() => {
    attachRef.current = attach
    droppedRef.current = onDropped
  })

  useEffect(() => {
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth.current += 1
      setActive(true)
    }
    // A composer takes its own drops (attachments for the next message);
    // over one, this overlay steps aside.
    const overComposer = (event: DragEvent) =>
      event.target instanceof Element && Boolean(event.target.closest('[data-attach-drop]'))
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      setActive(!overComposer(event))
    }
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setActive(false)
    }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth.current = 0
      setActive(false)
      if (event.defaultPrevented) return
      event.preventDefault()
      const files = [...(event.dataTransfer?.files ?? [])]
      if (files.length === 0) return
      const ids = addDocumentFiles(files)
      if (ids.length > 0) attachRef.current(ids)
      droppedRef.current()
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  if (!active) return null
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm" data-testid="documents-drop-overlay">
      <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-foreground/40 px-10 py-8 text-center">
        <Upload className="size-6 text-foreground" />
        <span className="text-sm font-medium text-foreground">Drop to add to this chat’s documents</span>
        <span className="text-xs text-muted-foreground">PDF, Markdown, or text · stays in this browser</span>
      </div>
    </div>
  )
}
