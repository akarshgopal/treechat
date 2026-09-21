import assert from 'node:assert/strict'
import test from 'node:test'
import { reducer } from './tree-reducer.ts'
import type { ChatMessage, Thread, TreeState } from '../types.ts'

const msg = (id: string): ChatMessage => ({
  id,
  role: 'user',
  content: id,
  createdAt: 0,
})

const thread = (id: string, parentId: string | null, messages: string[] = []): Thread => ({
  id,
  parentId,
  anchor: parentId
    ? { messageId: 'anchor', start: 0, end: 3, quote: 'abc' }
    : null,
  messages: messages.map(msg),
  createdAt: 0,
  rev: 0,
})

// root ── b1 ── b1a
//      └─ b2
function base(): TreeState {
  return {
    threads: {
      root: thread('root', null, ['r1']),
      b1: thread('b1', 'root', ['x']),
      b1a: thread('b1a', 'b1', ['y']),
      b2: thread('b2', 'root'),
    },
    rootId: 'root',
    activeThreadId: 'root',
    expanded: { root: 'b1', b1: 'b1a' },
  }
}

test('creating a thread expands it inside its parent', () => {
  const next = reducer(base(), {
    type: 'create-thread',
    thread: thread('b3', 'root'),
  })
  assert.equal(next.expanded.root, 'b3')
  assert.equal(next.threads.b3.parentId, 'root')
})

test('creating a nested thread also expands ancestors', () => {
  const state = { ...base(), expanded: {} }
  const next = reducer(state, {
    type: 'create-thread',
    thread: thread('b1b', 'b1'),
  })
  assert.equal(next.expanded.b1, 'b1b')
  assert.equal(next.expanded.root, 'b1')
})

test('replace-messages does not bump rev, append-message does', () => {
  const replaced = reducer(base(), {
    type: 'replace-messages',
    threadId: 'b1',
    messages: [msg('z')],
  })
  assert.equal(replaced.threads.b1.rev, 0)

  const appended = reducer(base(), {
    type: 'append-message',
    threadId: 'b1',
    message: msg('summary'),
  })
  assert.equal(appended.threads.b1.rev, 1)
  assert.deepEqual(appended.threads.b1.messages.map((m) => m.id), ['x', 'summary'])
})

test('discarding a branch takes its whole subtree', () => {
  const next = reducer(base(), { type: 'discard', threadId: 'b1' })
  assert.deepEqual(Object.keys(next.threads).sort(), ['b2', 'root'])
})

test('discarding clears expansion pointing at the removed subtree', () => {
  const next = reducer(base(), { type: 'discard', threadId: 'b1' })
  assert.equal(next.expanded.root, null)
  assert.ok(!('b1' in next.expanded), 'the removed thread keeps no expansion entry')
})

test('discarding the thread holding the frame retreats to its parent', () => {
  const state = { ...base(), activeThreadId: 'b1a' }
  const next = reducer(state, { type: 'discard', threadId: 'b1' })
  assert.equal(next.activeThreadId, 'root')
})

test('the root thread cannot be discarded', () => {
  const state = base()
  assert.equal(reducer(state, { type: 'discard', threadId: 'root' }), state)
})

test('focus only moves to a thread that exists', () => {
  assert.equal(reducer(base(), { type: 'focus', threadId: 'b2' }).activeThreadId, 'b2')
  assert.equal(reducer(base(), { type: 'focus', threadId: 'gone' }).activeThreadId, 'root')
})

test('focus reveals the path by expanding ancestors', () => {
  const state = { ...base(), expanded: {} }
  const next = reducer(state, { type: 'focus', threadId: 'b1a' })
  assert.equal(next.activeThreadId, 'b1a')
  assert.equal(next.expanded.root, 'b1')
  assert.equal(next.expanded.b1, 'b1a')
})

test('expand collapses when passed null', () => {
  const next = reducer(base(), { type: 'expand', parentId: 'root', childId: null })
  assert.equal(next.expanded.root, null)
})

test('actions against a missing thread are inert', () => {
  const state = base()
  assert.equal(
    reducer(state, { type: 'append-message', threadId: 'gone', message: msg('a') }),
    state,
  )
})

test('reset replaces the tree with an empty root thread', () => {
  const next = reducer(base(), { type: 'reset' })
  assert.equal(Object.keys(next.threads).length, 1)
  const root = next.threads[next.rootId]
  assert.ok(root)
  assert.equal(root.parentId, null)
  assert.equal(root.anchor, null)
  assert.deepEqual(root.messages, [])
  assert.equal(next.activeThreadId, next.rootId)
  assert.deepEqual(next.expanded, {})
  assert.ok(
    !Object.values(next.threads).some((thread) =>
      thread.messages.some((message) => message.content === 'What is TreeChat?'),
    ),
  )
})

test('restoreDemo loads the seeded walkthrough', () => {
  const next = reducer(base(), { type: 'restoreDemo' })
  const root = next.threads[next.rootId]
  assert.ok(root)
  assert.ok(root.messages.some((message) => message.content === 'What is TreeChat?'))
  assert.ok(Object.keys(next.threads).length > 1)
})
