import assert from 'node:assert/strict'
import test from 'node:test'
import {
  revealThreadInRail,
  setsEqual,
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
