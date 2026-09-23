import { useEffect, useSyncExternalStore } from 'react'
import { createId } from '../ids.ts'
import { getEmbedder } from './active-embedder.ts'
import { formatOf } from './extract.ts'
import { indexFile, type IndexProgress } from './ingest.ts'
import { forgetCachedChunks } from './retrieve.ts'
import { deleteDocument, listDocuments, putDocument } from './store.ts'
import type { StoredDocument } from './types.ts'

export type DocumentLibrary = {
  documents: StoredDocument[]
  /** Live progress for documents being indexed in this tab. */
  progress: Record<string, IndexProgress | { stage: 'queued' }>
  loaded: boolean
  /** Last thing worth telling the person (a skipped file, a storage error). */
  notice?: string
}

let state: DocumentLibrary = { documents: [], progress: {}, loaded: false }
const listeners = new Set<() => void>()
let loading: Promise<void> | null = null
/** Files wait their turn: one at a time keeps memory and the worker calm. */
let queue: Promise<unknown> = Promise.resolve()

function set(next: Partial<DocumentLibrary>) {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Files waiting in the queue, shown before their record is stored. */
const queued = new Map<string, StoredDocument>()

async function refresh() {
  try {
    const stored = await listDocuments()
    const ids = new Set(stored.map((doc) => doc.id))
    const waiting = [...queued.values()].filter((doc) => !ids.has(doc.id))
    set({ documents: [...stored, ...waiting], loaded: true })
  } catch (error) {
    set({ loaded: true, notice: error instanceof Error ? error.message : 'Could not open document storage.' })
  }
}

/** Load once per page. A document still "indexing" from a closed tab never finished. */
export function loadDocumentLibrary() {
  if (!loading) {
    loading = (async () => {
      try {
        for (const doc of await listDocuments()) {
          if (doc.status === 'indexing' && !state.progress[doc.id]) {
            await putDocument({ ...doc, status: 'error', error: 'Indexing was interrupted. Remove it and add the file again.' })
          }
        }
      } catch {
        // refresh reports storage problems
      }
      await refresh()
    })()
  }
  return loading
}

/**
 * Queue files for indexing. Returns the new documents' ids right away so the
 * caller can attach them to a chat before indexing finishes.
 */
export function addDocumentFiles(files: Iterable<File>): string[] {
  const ids: string[] = []
  const skipped: string[] = []
  for (const file of files) {
    if (!formatOf(file.name, file.type)) {
      skipped.push(file.name)
      continue
    }
    const id = createId('doc')
    ids.push(id)
    const placeholder: StoredDocument = {
      id, name: file.name, format: formatOf(file.name, file.type)!, size: file.size,
      createdAt: Date.now(), status: 'indexing', chunkCount: 0,
    }
    queued.set(id, placeholder)
    set({
      documents: [...state.documents, placeholder],
      progress: { ...state.progress, [id]: { stage: 'queued' } },
    })
    queue = queue.then(async () => {
      try {
        await indexFile(file, {
          id,
          embedder: getEmbedder(),
          onProgress: (progress) => {
            set({ progress: { ...state.progress, [id]: progress } })
            // Show the new row as soon as its record exists.
            if (progress.stage === 'reading') void refresh()
          },
        })
      } catch (error) {
        set({ notice: `${file.name}: ${error instanceof Error ? error.message : 'could not be added.'}` })
      } finally {
        queued.delete(id)
        const progress = { ...state.progress }
        delete progress[id]
        set({ progress })
        await refresh()
      }
    })
  }
  set({ notice: skipped.length > 0 ? `Skipped ${skipped.join(', ')} — only PDF, Markdown, and text files can be added.` : undefined })
  return ids
}

export async function removeDocument(id: string) {
  forgetCachedChunks(id)
  try {
    await deleteDocument(id)
  } catch (error) {
    set({ notice: error instanceof Error ? error.message : 'Could not remove the document.' })
  }
  await refresh()
}

export function dismissDocumentNotice() {
  set({ notice: undefined })
}

export function useDocumentLibrary(): DocumentLibrary {
  useEffect(() => {
    void loadDocumentLibrary()
  }, [])
  return useSyncExternalStore(subscribe, () => state)
}
