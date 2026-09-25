import type { Page } from '@playwright/test'
import type { ChatSession, SessionLibrary, TreeState } from '../../src/types'

/**
 * The chat library as the app last saved it: from IndexedDB, or from
 * localStorage when that is where it lives (before the first load migrates it,
 * or when IndexedDB failed).
 */
export async function savedLibrary(page: Page): Promise<SessionLibrary> {
  return page.evaluate(async () => {
    const stored = await new Promise<unknown>((resolve) => {
      const req = indexedDB.open('treechat-library')
      // No such database yet: don't create an empty one the app would then trip over.
      req.onupgradeneeded = () => req.transaction!.abort()
      req.onerror = () => resolve(undefined)
      req.onsuccess = () => {
        const db = req.result
        const get = db.transaction('library').objectStore('library').get('current')
        get.onsuccess = () => resolve(get.result)
        get.onerror = () => resolve(undefined)
        db.close()
      }
    })
    return (stored ?? JSON.parse(localStorage.getItem('treechat:v3') ?? 'null')) as SessionLibrary
  })
}

export async function activeSession(page: Page): Promise<ChatSession> {
  const library = await savedLibrary(page)
  return library.sessions.find((session) => session.id === library.activeSessionId)!
}

export async function tree(page: Page): Promise<TreeState> {
  return (await activeSession(page)).treeState
}
