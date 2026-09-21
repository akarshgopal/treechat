import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultExpandedIds,
  loadExpandedIds,
  parseExpandedIds,
  railCollapseStorageKey,
  revealThreadInRail,
  saveExpandedIds,
  setsEqual,
  toggleExpandedId,
  visibleRailThreads,
} from './rail-collapse.ts'
import type { ChatMessage, Thread, TreeState } from '../types.ts'

const msg = (id: string, role: 'user' | 'assistant', content: string): ChatMessage => ({
  id,
  role,
  content,
  createdAt: 0,
})

const thread = (
  id: string,
  parentId: string | null,
  quote: string,
  messages: ChatMessage[],
  createdAt = 0,
): Thread => ({
  id,
  parentId,
  anchor: parentId
    ? { messageId: `${parentId}-m`, start: 0, end: quote.length, quote }
    : null,
  messages,
  createdAt,
  rev: 0,
})

// root ── b1 ── b1a
//      └─ b2
const root = thread('root', null, '', [msg('r1', 'user', 'hello')], 0)
const b1 = thread('b1', 'root', 'branch one', [msg('b1m', 'user', 'one')], 1)
const b1a = thread('b1a', 'b1', 'nested', [msg('b1am', 'user', 'nested')], 2)
const b2 = thread('b2', 'root', 'branch two', [], 3)

const state: TreeState = {
  threads: { root, b1, b1a, b2 },
  rootId: 'root',
  activeThreadId: 'root',
  expanded: {},
}

const known = new Set(Object.keys(state.threads))

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

test('default expanded set is only the root', () => {
  assert.deepEqual(defaultExpandedIds('root'), ['root'])
})

test('toggle adds then removes an id', () => {
  const once = toggleExpandedId(new Set(['root']), 'b1')
  assert.equal(once.has('root'), true)
  assert.equal(once.has('b1'), true)
  const twice = toggleExpandedId(once, 'b1')
  assert.equal(twice.has('b1'), false)
  assert.equal(twice.has('root'), true)
})

test('toggle can collapse the root', () => {
  const next = toggleExpandedId(new Set(['root']), 'root')
  assert.equal(next.size, 0)
})

test('parse missing or invalid payloads uses the default', () => {
  assert.deepEqual([...parseExpandedIds(null, known, 'root')].sort(), ['root'])
  assert.deepEqual([...parseExpandedIds(undefined, known, 'root')].sort(), ['root'])
  assert.deepEqual([...parseExpandedIds('nope', known, 'root')].sort(), ['root'])
  assert.deepEqual([...parseExpandedIds({ expanded: 3 }, known, 'root')].sort(), ['root'])
  assert.deepEqual([...parseExpandedIds({ other: ['root'] }, known, 'root')].sort(), ['root'])
})

test('parse accepts a raw array or { expanded } and drops unknown ids', () => {
  assert.deepEqual(
    [...parseExpandedIds(['root', 'b1', 'gone'], known, 'root')].sort(),
    ['b1', 'root'],
  )
  assert.deepEqual(
    [...parseExpandedIds({ expanded: ['root', 'b1a'] }, known, 'root')].sort(),
    ['b1a', 'root'],
  )
})

test('parse keeps an explicit empty list (root collapsed)', () => {
  assert.equal(parseExpandedIds([], known, 'root').size, 0)
  assert.equal(parseExpandedIds({ expanded: [] }, known, 'root').size, 0)
})

test('parse falls back when every stored id is stale', () => {
  assert.deepEqual(
    [...parseExpandedIds(['old-root', 'old-branch'], known, 'root')].sort(),
    ['root'],
  )
})

test('load and save round-trip per session key', () => {
  const storage = mockLocalStorage()
  saveExpandedIds('session-a', new Set(['root', 'b1']))
  saveExpandedIds('session-b', new Set(['root']))
  assert.equal(
    storage.getItem(railCollapseStorageKey('session-a')),
    JSON.stringify({ expanded: ['root', 'b1'] }),
  )
  assert.deepEqual(
    [...loadExpandedIds('session-a', known, 'root')].sort(),
    ['b1', 'root'],
  )
  assert.deepEqual([...loadExpandedIds('session-b', known, 'root')].sort(), ['root'])
  assert.deepEqual(
    [...loadExpandedIds('session-missing', known, 'root')].sort(),
    ['root'],
  )
})

test('load falls back on unreadable JSON', () => {
  const storage = mockLocalStorage()
  storage.setItem(railCollapseStorageKey('session-a'), '{not-json')
  assert.deepEqual([...loadExpandedIds('session-a', known, 'root')].sort(), ['root'])
})

test('visibleRailThreads hides children of collapsed nodes', () => {
  const onlyRoot = visibleRailThreads(state, new Set(['root']))
  assert.deepEqual(
    onlyRoot.map((item) => item.id),
    ['root', 'b1', 'b2'],
  )
  const b1Open = visibleRailThreads(state, new Set(['root', 'b1']))
  assert.deepEqual(
    b1Open.map((item) => item.id),
    ['root', 'b1', 'b1a', 'b2'],
  )
  const collapsed = visibleRailThreads(state, new Set())
  assert.deepEqual(
    collapsed.map((item) => item.id),
    ['root'],
  )
})

test('revealThreadInRail expands ancestors of a nested thread', () => {
  const revealed = revealThreadInRail(state, new Set(['root']), 'b1a')
  assert.equal(revealed.has('root'), true)
  assert.equal(revealed.has('b1'), true)
  assert.equal(revealed.has('b1a'), false)
  assert.equal(setsEqual(revealed, new Set(['root', 'b1'])), true)
})

test('revealThreadInRail is a no-op for the root or an unknown id', () => {
  const atRoot = revealThreadInRail(state, new Set(['root']), 'root')
  assert.equal(setsEqual(atRoot, new Set(['root'])), true)
  const missing = revealThreadInRail(state, new Set(['root']), 'gone')
  assert.equal(setsEqual(missing, new Set(['root'])), true)
})
