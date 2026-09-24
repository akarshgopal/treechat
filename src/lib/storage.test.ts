import assert from 'node:assert/strict'
import test from 'node:test'
import { createEmptyState, createSeedState } from './seed.ts'
import { loadLibrary, loadTreeState, saveLibrary, saveTreeState } from './storage.ts'
import { LEGACY_STORAGE_KEY, STORAGE_KEY, V2_STORAGE_KEY } from '../types.ts'

function mockLocalStorage() {
  const data = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return data.size
    },
    clear() {
      data.clear()
    },
    getItem(key) {
      return data.has(key) ? data.get(key)! : null
    },
    key(index) {
      return [...data.keys()][index] ?? null
    },
    removeItem(key) {
      data.delete(key)
    },
    setItem(key, value) {
      data.set(key, String(value))
    },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  })
  return storage
}

test('empty state round-trips without being re-seeded', () => {
  mockLocalStorage()
  const empty = createEmptyState()
  saveTreeState(empty)
  const loaded = loadTreeState()
  assert.equal(loaded.rootId, empty.rootId)
  assert.deepEqual(loaded.threads[loaded.rootId]?.messages, [])
  assert.equal(Object.keys(loaded.threads).length, 1)
  assert.equal(localStorage.getItem(STORAGE_KEY)?.includes('What is TreeChat?'), false)
})

test('existing v2 seed state is kept', () => {
  mockLocalStorage()
  const seed = createSeedState()
  saveTreeState(seed)
  const loaded = loadTreeState()
  assert.ok(
    loaded.threads[loaded.rootId]?.messages.some(
      (message) => message.content === 'What is TreeChat?',
    ),
  )
  assert.equal(Object.keys(loaded.threads).length, Object.keys(seed.threads).length)
})

test('unreadable v3 payload falls back to empty, not seed', () => {
  const storage = mockLocalStorage()
  storage.setItem(STORAGE_KEY, '{not-json')
  const loaded = loadTreeState()
  assert.deepEqual(loaded.threads[loaded.rootId]?.messages, [])
  assert.equal(Object.keys(loaded.threads).length, 1)
})

test('a v2 single tree migrates into one session on first load', () => {
  const storage = mockLocalStorage()
  const seed = createSeedState()
  storage.setItem(V2_STORAGE_KEY, JSON.stringify(seed))
  const library = loadLibrary()
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
  const persisted = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null') as {
    sessions: unknown[]
  }
  assert.equal(persisted.sessions.length, 1)
})

test('a v1 spine migrates into one session', () => {
  const storage = mockLocalStorage()
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
  const library = loadLibrary()
  assert.equal(library.sessions.length, 1)
  const tree = library.sessions[0]!.treeState
  assert.equal(library.sessions[0]?.title, 'Hello from v1')
  assert.ok(tree.threads[tree.rootId]?.messages.some((message) => message.content === 'Hello from v1'))
  assert.ok(tree.threads.b1)
  assert.equal(tree.threads.b1.parentId, tree.rootId)
})

test('v3 library round-trips and wins over a leftover v2 blob', () => {
  mockLocalStorage()
  const empty = createEmptyState()
  const seed = createSeedState()
  saveLibrary({
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
  const loaded = loadLibrary()
  assert.equal(loaded.sessions.length, 2)
  assert.equal(loaded.activeSessionId, 'keep')
  assert.equal(loaded.sessions[0]?.title, 'Saved chat')
  assert.deepEqual(loadTreeState().threads[loadTreeState().rootId]?.messages, [])
})

test('unreadable v3 falls through to a leftover v2 tree', () => {
  const storage = mockLocalStorage()
  storage.setItem(STORAGE_KEY, '{not-json')
  storage.setItem(V2_STORAGE_KEY, JSON.stringify(createSeedState()))
  const library = loadLibrary()
  assert.equal(library.sessions.length, 1)
  assert.equal(library.sessions[0]?.title, 'What is TreeChat?')
})

test('a thread summary survives storage, and a stale one is dropped', () => {
  mockLocalStorage()
  const state = createSeedState()
  const root = state.threads[state.rootId]
  const throughMessageId = root.messages[1].id
  root.summary = { content: 'Earlier: the basics', throughMessageId, createdAt: 5 }
  saveTreeState(state)
  assert.deepEqual(loadTreeState().threads[state.rootId].summary, root.summary)

  root.summary = { content: 'Earlier: gone', throughMessageId: 'not-a-message', createdAt: 5 }
  saveTreeState(state)
  assert.ok(!('summary' in loadTreeState().threads[state.rootId]))
  // Threads without one stay free of the key (strict round-trips elsewhere rely on it).
  const branch = Object.values(loadTreeState().threads).find((thread) => thread.parentId)
  assert.ok(branch && !('summary' in branch))
})

test('a full storage refuses the save and reports it, without dropping any chat', () => {
  const storage = mockLocalStorage()
  const first = loadLibrary()
  assert.equal(saveLibrary(first), 'saved')
  const before = storage.getItem(STORAGE_KEY)
  storage.setItem = () => {
    throw new DOMException('quota', 'QuotaExceededError')
  }
  const bigger = { ...first, sessions: [...first.sessions, { ...first.sessions[0]!, id: 'second', updatedAt: 0 }] }
  assert.equal(saveLibrary(bigger), 'full')
  // What was saved before stays intact; nothing was deleted to make room.
  assert.equal(storage.getItem(STORAGE_KEY), before)
})
