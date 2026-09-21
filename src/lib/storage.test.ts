import assert from 'node:assert/strict'
import test from 'node:test'
import { createEmptyState, createSeedState } from './seed.ts'
import { loadTreeState, saveTreeState } from './storage.ts'
import { STORAGE_KEY } from '../types.ts'

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

test('loadTreeState uses empty state when nothing is stored', () => {
  mockLocalStorage()
  const state = loadTreeState()
  assert.deepEqual(state.threads[state.rootId]?.messages, [])
  assert.equal(Object.keys(state.threads).length, 1)
  assert.ok(
    !Object.values(state.threads).some((thread) =>
      thread.messages.some((message) => message.content === 'What is TreeChat?'),
    ),
  )
})

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

test('unreadable v2 payload falls back to empty, not seed', () => {
  const storage = mockLocalStorage()
  storage.setItem(STORAGE_KEY, '{not-json')
  const loaded = loadTreeState()
  assert.deepEqual(loaded.threads[loaded.rootId]?.messages, [])
  assert.equal(Object.keys(loaded.threads).length, 1)
})
