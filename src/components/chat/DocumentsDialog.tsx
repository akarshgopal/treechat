import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { AddFilesButton } from '@/components/chat/Documents'
import { useChatDocuments } from '@/components/chat/use-chat-documents'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  dismissDocumentNotice,
  removeDocument,
  useDocumentLibrary,
  type DocumentLibrary,
} from '@/lib/documents/library'
import { DEFAULT_EMBEDDING_MODEL_MB } from '@/lib/documents/model-embedder'
import type { StoredDocument } from '@/lib/documents/types'
import { cn } from '@/lib/utils'
import { useTree } from '@/store/tree-store'

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
