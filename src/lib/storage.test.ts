import { IDBFactory } from 'fake-indexeddb'
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { beforeEach } from 'node:test'
import test from 'node:test'
import { createEmptyState, createSeedState } from './seed.ts'
import { libraryFromTree } from './sessions.ts'
import { closeLibraryStore, loadLibrary, saveLibrary } from './storage.ts'
import { installLocalStorage } from '../test-support/local-storage.ts'
import { LEGACY_STORAGE_KEY, STORAGE_KEY, V2_STORAGE_KEY, type SessionLibrary } from '../types.ts'

/** A fresh, empty IndexedDB per test; `false` for a browser without one. */
async function useIndexedDB(available = true) {
  await closeLibraryStore()
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, writable: true, value: available ? new IDBFactory() : undefined })
}

beforeEach(() => useIndexedDB())

const activeTree = (library: SessionLibrary) =>
  library.sessions.find((session) => session.id === library.activeSessionId)!.treeState

test('empty state round-trips without being re-seeded', async () => {
  installLocalStorage()
  const empty = createEmptyState()
  await saveLibrary(libraryFromTree(empty))
  const loaded = activeTree(await loadLibrary())
  assert.equal(loaded.rootId, empty.rootId)
  assert.deepEqual(loaded.threads[loaded.rootId]?.messages, [])
  assert.equal(Object.keys(loaded.threads).length, 1)
  assert.equal(JSON.stringify(await loadLibrary()).includes('What is TreeChat?'), false)
})

test('unreadable v3 payload falls back to empty, not seed', async () => {
  const storage = installLocalStorage()
  storage.setItem(STORAGE_KEY, '{not-json')
  const loaded = activeTree(await loadLibrary())
  assert.deepEqual(loaded.threads[loaded.rootId]?.messages, [])
  assert.equal(Object.keys(loaded.threads).length, 1)
})

test('a v2 single tree migrates into one session on first load', async () => {
  const storage = installLocalStorage()
  const seed = createSeedState()
  storage.setItem(V2_STORAGE_KEY, JSON.stringify(seed))
  const library = await loadLibrary()
  assert.equal(library.sessions.length, 1)
  const session = library.sessions[0]!
  assert.equal(library.activeSessionId, session.id)
  assert.equal(session.title, 'What is TreeChat?')
  assert.ok(
    session.treeState.threads[session.treeState.rootId]?.messages.some(
      (message) => message.content === 'What is TreeChat?',
    ),
  )
  assert.equal(Object.keys(session.treeState.threads).length, Object.keys(seed.threads).length)
  // Saved as a v3 library straight away (the v2 blob is left alone).
  storage.removeItem(V2_STORAGE_KEY)
  assert.deepEqual((await loadLibrary()).sessions.map((entry) => entry.id), [session.id])
})

test('a v1 spine migrates into one session', async () => {
  const storage = installLocalStorage()
  storage.setItem(
    LEGACY_STORAGE_KEY,
    JSON.stringify({
      spine: [
        { id: 'm1', role: 'user', content: 'Hello from v1', createdAt: 1 },
        { id: 'm2', role: 'assistant', content: 'Hi', createdAt: 2 },
      ],
      branches: [
        {
          id: 'b1',
          sourceMessageId: 'm2',
          start: 0,
          end: 2,
          quote: 'Hi',
          messages: [{ id: 'm3', role: 'user', content: 'tangent', createdAt: 3 }],
          createdAt: 3,
        },
      ],
    }),
  )
  const library = await loadLibrary()
  assert.equal(library.sessions.length, 1)
  const tree = library.sessions[0]!.treeState
  assert.equal(library.sessions[0]?.title, 'Hello from v1')
  assert.ok(tree.threads[tree.rootId]?.messages.some((message) => message.content === 'Hello from v1'))
  assert.ok(tree.threads.b1)
  assert.equal(tree.threads.b1.parentId, tree.rootId)
})

test('v3 library round-trips and wins over a leftover v2 blob', async () => {
  installLocalStorage()
  const empty = createEmptyState()
  const seed = createSeedState()
  await saveLibrary({
    sessions: [
      {
        id: 'keep',
        title: 'Saved chat',
        createdAt: 1,
        updatedAt: 2,
        treeState: empty,
        titleLocked: true,
      },
      {
        id: 'demo',
        title: 'What is TreeChat?',
        createdAt: 3,
        updatedAt: 4,
        treeState: seed,
        titleLocked: false,
      },
    ],
    activeSessionId: 'keep',
  })
  localStorage.setItem(V2_STORAGE_KEY, JSON.stringify(seed))
  const loaded = await loadLibrary()
  assert.equal(loaded.sessions.length, 2)
  assert.equal(loaded.activeSessionId, 'keep')
  assert.equal(loaded.sessions[0]?.title, 'Saved chat')
  const active = activeTree(loaded)
  assert.deepEqual(active.threads[active.rootId]?.messages, [])
})

test('unreadable v3 falls through to a leftover v2 tree', async () => {
  const storage = installLocalStorage()
  storage.setItem(STORAGE_KEY, '{not-json')
  storage.setItem(V2_STORAGE_KEY, JSON.stringify(createSeedState()))
  const library = await loadLibrary()
  assert.equal(library.sessions.length, 1)
  assert.equal(library.sessions[0]?.title, 'What is TreeChat?')
})

test('a thread summary survives storage, and a stale one is dropped', async () => {
  installLocalStorage()
  const state = createSeedState()
  const root = state.threads[state.rootId]
  const throughMessageId = root.messages[1].id
  root.summary = { content: 'Earlier: the basics', throughMessageId, createdAt: 5 }
  await saveLibrary(libraryFromTree(state))
  assert.deepEqual(activeTree(await loadLibrary()).threads[state.rootId].summary, root.summary)

  root.summary = { content: 'Earlier: gone', throughMessageId: 'not-a-message', createdAt: 5 }
  await saveLibrary(libraryFromTree(state))
  const reloaded = activeTree(await loadLibrary())
  assert.ok(!('summary' in reloaded.threads[state.rootId]))
  // Threads without one stay free of the key (strict round-trips elsewhere rely on it).
  const branch = Object.values(reloaded.threads).find((thread) => thread.parentId)
  assert.ok(branch && !('summary' in branch))
})

test('chats in localStorage move to IndexedDB on first load, and the old copy goes', async () => {
  const storage = installLocalStorage()
  const seed = createSeedState()
  storage.setItem(STORAGE_KEY, JSON.stringify({
    sessions: [{ id: 'old', title: 'From localStorage', createdAt: 1, updatedAt: 2, treeState: seed, titleLocked: true }],
    activeSessionId: 'old',
  }))
  const library = await loadLibrary()
  assert.equal(library.sessions[0]?.title, 'From localStorage')
  assert.equal(storage.getItem(STORAGE_KEY), null)
  assert.equal((await loadLibrary()).sessions[0]?.title, 'From localStorage')
})

test('without IndexedDB, chats are saved to localStorage and move over once it works', async () => {
  const storage = installLocalStorage()
  await useIndexedDB(false)
  const library = await loadLibrary()
  const renamed = { ...library, sessions: [{ ...library.sessions[0]!, title: 'Saved without IndexedDB' }] }
  assert.equal(await saveLibrary(renamed), 'saved')
  assert.ok(storage.getItem(STORAGE_KEY)?.includes('Saved without IndexedDB'))
  assert.equal((await loadLibrary()).sessions[0]?.title, 'Saved without IndexedDB')

  // IndexedDB is back but holds an older copy: the newer localStorage one wins.
  await useIndexedDB()
  await saveLibrary({ ...library, sessions: [{ ...library.sessions[0]!, title: 'Older' }] })
  storage.setItem(STORAGE_KEY, JSON.stringify({ ...renamed, savedAt: Date.now() + 1_000 }))
  assert.equal((await loadLibrary()).sessions[0]?.title, 'Saved without IndexedDB')
  assert.equal(storage.getItem(STORAGE_KEY), null)
})

test('a full storage refuses the save and reports it, without dropping any chat', async () => {
  installLocalStorage()
  const first = await loadLibrary()
  assert.equal(await saveLibrary(first), 'saved')
  const put = IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put = () => {
    throw new DOMException('quota', 'QuotaExceededError')
  }
  try {
    const bigger = { ...first, sessions: [...first.sessions, { ...first.sessions[0]!, id: 'second', updatedAt: 0 }] }
    assert.equal(await saveLibrary(bigger), 'full')
  } finally {
    IDBObjectStore.prototype.put = put
  }
  // What was saved before stays intact; nothing was deleted to make room.
  assert.deepEqual(await loadLibrary(), first)
})
