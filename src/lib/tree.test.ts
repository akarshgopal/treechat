import assert from 'node:assert/strict'
import test from 'node:test'
import {
  childThreadsForMessage,
  depthOf,
  descendantIds,
  pathTo,
  subtreeSize,
  threadContext,
  transcriptUpTo,
} from './tree.ts'
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
  anchorMessageId: string | null,
  quote: string,
  messages: ChatMessage[],
  createdAt = 0,
): Thread => ({
  id,
  parentId,
  anchor: anchorMessageId
    ? { messageId: anchorMessageId, start: 0, end: quote.length, quote }
    : null,
  messages,
  createdAt,
  rev: 0,
})

// root ── b1 ── b1a
//      └─ b2
const root = thread('root', null, null, '', [
  msg('r1', 'user', 'why is /orders slow?'),
  msg('r2', 'assistant', 'stale stats, or a type mismatch in the predicate'),
  msg('r3', 'user', 'unrelated follow up'),
])
const b1 = thread('b1', 'root', 'r2', 'a type mismatch in the predicate', [
  msg('b1m1', 'user', 'how would I spot one?'),
  msg('b1m2', 'assistant', 'look for a cast on the column side'),
], 1)
const b1a = thread('b1a', 'b1', 'b1m2', 'a cast on the column side', [
  msg('b1am1', 'user', 'why does that break the index?'),
], 2)
const b2 = thread('b2', 'root', 'r2', 'stale stats', [], 3)

const state: TreeState = {
  threads: { root, b1, b1a, b2 },
  rootId: 'root',
  activeThreadId: 'root',
  expanded: {},
}

test('a branch of a branch resolves its full path', () => {
  assert.deepEqual(pathTo(state, 'b1a').map((t) => t.id), ['root', 'b1', 'b1a'])
  assert.equal(depthOf(state, 'b1a'), 2)
  assert.equal(depthOf(state, 'root'), 0)
})

test('children are found per anchoring message', () => {
  assert.deepEqual(
    childThreadsForMessage(state, 'root', 'r2').map((t) => t.id),
    ['b1', 'b2'],
  )
  assert.deepEqual(childThreadsForMessage(state, 'root', 'r1'), [])
  assert.deepEqual(
    childThreadsForMessage(state, 'b1', 'b1m2').map((t) => t.id),
    ['b1a'],
  )
})

test('descendants and subtree size walk the whole branch', () => {
  assert.deepEqual(descendantIds(state, 'b1').sort(), ['b1', 'b1a'])
  assert.equal(subtreeSize(state, 'b1'), 3)
  assert.equal(subtreeSize(state, 'b2'), 0)
  assert.equal(subtreeSize(state, 'root'), 6)
})

test('transcript stops at the anchor message', () => {
  const out = transcriptUpTo(root.messages, 'r2')
  assert.match(out, /type mismatch in the predicate$/)
  assert.ok(!out.includes('unrelated follow up'))
})

test('the root thread has no upstream context', () => {
  assert.equal(threadContext(state, 'root'), '')
})

test('a first-level branch carries the main thread up to its anchor', () => {
  const out = threadContext(state, 'b1')
  assert.ok(out.includes('Main thread'))
  assert.ok(out.includes('why is /orders slow?'))
  assert.ok(out.includes('«a type mismatch in the predicate»'))
  assert.ok(!out.includes('unrelated follow up'))
})

test('a nested branch carries every level above it, root first', () => {
  const out = threadContext(state, 'b1a')
  const mainAt = out.indexOf('Main thread')
  const branchAt = out.indexOf('Branch (depth 1)')
  assert.ok(mainAt >= 0 && branchAt > mainAt, 'root section precedes the branch section')
  // the outer quote and the inner quote both survive
  assert.ok(out.includes('«a type mismatch in the predicate»'))
  assert.ok(out.includes('«a cast on the column side»'))
  // and the branch's own turns are present as context for the nested thread
  assert.ok(out.includes('how would I spot one?'))
})

test('an unknown thread yields an empty path rather than throwing', () => {
  assert.deepEqual(pathTo(state, 'nope'), [])
  assert.equal(threadContext(state, 'nope'), '')
})
