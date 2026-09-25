import type { DocumentChunk, StoredDocument } from './types.ts'

/**
 * IndexedDB persistence for documents and their chunks (with vectors as
 * Float32Array). localStorage would run out after a few PDFs, and this data
 * never needs to be synchronous.
 */

const DB_NAME = 'treechat-documents'
const DB_VERSION = 1
const DOCUMENTS = 'documents'
const CHUNKS = 'chunks'

let opening: Promise<IDBDatabase> | null = null

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'))
  })
}

function open(): Promise<IDBDatabase> {
  if (opening) return opening
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser cannot store documents (no IndexedDB).'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(DOCUMENTS)) db.createObjectStore(DOCUMENTS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(CHUNKS)) {
        db.createObjectStore(CHUNKS, { keyPath: 'id' }).createIndex('documentId', 'documentId')
      }
    }
    req.onsuccess = () => {
      const db = req.result
      // Another tab upgrading the schema: step aside and reopen next time.
      db.onversionchange = () => {
        db.close()
        opening = null
      }
      resolve(db)
    }
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('Document storage is blocked by another tab.'))
  })
  opening.catch(() => { opening = null })
  return opening
}

export async function listDocuments(): Promise<StoredDocument[]> {
  const db = await open()
  const docs = await request(db.transaction(DOCUMENTS).objectStore(DOCUMENTS).getAll() as IDBRequest<StoredDocument[]>)
  return docs.sort((a, b) => a.createdAt - b.createdAt)
}

export async function getDocument(id: string): Promise<StoredDocument | undefined> {
  const db = await open()
  return request(db.transaction(DOCUMENTS).objectStore(DOCUMENTS).get(id) as IDBRequest<StoredDocument | undefined>)
}

export async function putDocument(doc: StoredDocument): Promise<void> {
  const db = await open()
  const tx = db.transaction(DOCUMENTS, 'readwrite')
  tx.objectStore(DOCUMENTS).put(doc)
  await done(tx)
}

/** Replace a document's chunks and record in one transaction. */
export async function saveIndexedDocument(doc: StoredDocument, chunks: DocumentChunk[]): Promise<void> {
  const db = await open()
  const tx = db.transaction([DOCUMENTS, CHUNKS], 'readwrite')
  const store = tx.objectStore(CHUNKS)
  deleteChunksOf(store, doc.id, () => {
    for (const chunk of chunks) store.put(chunk)
  })
  tx.objectStore(DOCUMENTS).put(doc)
  await done(tx)
}

export async function deleteDocument(id: string): Promise<void> {
  const db = await open()
  const tx = db.transaction([DOCUMENTS, CHUNKS], 'readwrite')
  tx.objectStore(DOCUMENTS).delete(id)
  deleteChunksOf(tx.objectStore(CHUNKS), id)
  await done(tx)
}

/**
 * Queue deletes from inside the request callback: awaiting a promise between
 * requests can let the transaction auto-commit first.
 */
function deleteChunksOf(store: IDBObjectStore, documentId: string, then?: () => void) {
  const keys = store.index('documentId').getAllKeys(documentId)
  keys.onsuccess = () => {
    for (const key of keys.result) store.delete(key)
    then?.()
  }
}

/** A document's chunks in reading order. */
export async function getChunks(documentId: string): Promise<DocumentChunk[]> {
  const db = await open()
  const chunks = await request(
    db.transaction(CHUNKS).objectStore(CHUNKS).index('documentId').getAll(documentId) as IDBRequest<DocumentChunk[]>,
  )
  return chunks.sort((a, b) => a.index - b.index)
}

/**
 * The document's text, rebuilt from its chunks without the overlap each
 * chunk repeats. Pages come back separated by blank lines.
 */
export async function getDocumentText(id: string): Promise<string> {
  const chunks = await getChunks(id)
  let text = ''
  for (const chunk of chunks) {
    if (!text) {
      text = chunk.text
      continue
    }
    text += `\n\n${stripOverlap(text, chunk.text)}`
  }
  return text
}

/** Drop the start of `next` that repeats the end of `previous`. */
function stripOverlap(previous: string, next: string) {
  const max = Math.min(previous.length, next.length, 400)
  for (let length = max; length >= 20; length -= 1) {
    if (previous.endsWith(next.slice(0, length))) return next.slice(length).trimStart()
  }
  return next
}
