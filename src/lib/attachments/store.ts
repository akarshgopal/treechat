/**
 * IndexedDB home for attachment contents. Messages keep only a small
 * `Attachment` record; the bytes (an image data URL or a file's text) live
 * here, so a few screenshots never exhaust localStorage.
 */

const DB_NAME = 'treechat-attachments'
const DB_VERSION = 1
const FILES = 'files'

export type StoredAttachment = {
  id: string
  /** `data:` URL for images, plain text for text files. */
  data: string
  createdAt: number
  /** A short text description of an image, written once, used in its place later. */
  description?: string
}

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
      reject(new Error('This browser cannot store attachments (no IndexedDB).'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(FILES)) req.result.createObjectStore(FILES, { keyPath: 'id' })
    }
    req.onsuccess = () => {
      const db = req.result
      db.onversionchange = () => {
        db.close()
        opening = null
      }
      resolve(db)
    }
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('Attachment storage is blocked by another tab.'))
  })
  opening.catch(() => { opening = null })
  return opening
}

export async function putAttachment(file: StoredAttachment): Promise<void> {
  const db = await open()
  const tx = db.transaction(FILES, 'readwrite')
  tx.objectStore(FILES).put(file)
  await done(tx)
}

export async function getAttachment(id: string): Promise<StoredAttachment | undefined> {
  const db = await open()
  return request(db.transaction(FILES).objectStore(FILES).get(id) as IDBRequest<StoredAttachment | undefined>)
}

export async function setAttachmentDescription(id: string, description: string): Promise<void> {
  const db = await open()
  const tx = db.transaction(FILES, 'readwrite')
  const store = tx.objectStore(FILES)
  const current = await request(store.get(id) as IDBRequest<StoredAttachment | undefined>)
  if (current) store.put({ ...current, description })
  await done(tx)
}

/**
 * Delete every stored attachment no chat refers to any more, except recent
 * ones: a file attached in another tab (or still in a composer) is not yet
 * in any saved message.
 */
export async function pruneAttachments(referenced: ReadonlySet<string>, olderThan: number): Promise<number> {
  const db = await open()
  const tx = db.transaction(FILES, 'readwrite')
  const store = tx.objectStore(FILES)
  const all = await request(store.getAll() as IDBRequest<StoredAttachment[]>)
  const doomed = all.filter((file) => !referenced.has(file.id) && file.createdAt < olderThan)
  for (const file of doomed) store.delete(file.id)
  await done(tx)
  return doomed.length
}

/** Tests: forget the open connection. */
export async function closeAttachmentStore() {
  const db = await opening?.catch(() => null)
  db?.close()
  opening = null
}
