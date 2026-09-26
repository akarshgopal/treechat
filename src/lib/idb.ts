/** Small shared IndexedDB helpers for the chat, document and attachment stores. */

export function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function idbDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'))
  })
}

/** An open that never settles (seen in some Safari versions) must not hang the app. */
const OPEN_TIMEOUT_MS = 4_000

/**
 * One connection per database, opened on first use and reused. It is dropped
 * (and reopened next time) when the open fails or another tab upgrades the
 * schema. `label` names what is stored, for error messages.
 */
export function idbDatabase({ name, version, label, upgrade }: {
  name: string
  version: number
  label: string
  upgrade: (db: IDBDatabase) => void
}) {
  let opening: Promise<IDBDatabase> | null = null

  function open(): Promise<IDBDatabase> {
    if (opening) return opening
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error(`This browser cannot store ${label} (no IndexedDB).`))
        return
      }
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        reject(new Error(`Storage for ${label} did not open.`))
      }, OPEN_TIMEOUT_MS)
      const req = indexedDB.open(name, version)
      req.onupgradeneeded = () => upgrade(req.result)
      req.onsuccess = () => {
        clearTimeout(timer)
        const db = req.result
        if (timedOut) {
          db.close()
          return
        }
        // Another tab upgrading the schema: step aside and reopen next time.
        db.onversionchange = () => {
          db.close()
          opening = null
        }
        resolve(db)
      }
      req.onerror = () => {
        clearTimeout(timer)
        reject(req.error)
      }
      req.onblocked = () => {
        clearTimeout(timer)
        reject(new Error(`Storage for ${label} is blocked by another tab.`))
      }
    })
    opening.catch(() => { opening = null })
    return opening
  }

  /** Close the connection; the next use opens a new one (tests swap the factory). */
  async function close() {
    const db = await opening?.catch(() => null)
    db?.close()
    opening = null
  }

  return { open, close }
}
