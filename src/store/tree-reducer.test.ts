import assert from 'node:assert/strict'
import test from 'node:test'
import {
  dropAnchorIdsForEdit,
  droppedMessageIds,
  editUserMessage,
  retryFromAssistant,
} from '../lib/message-actions.ts'
import { reducer } from './tree-reducer.ts'
import type { ChatMessage, Thread, TreeState } from '../types.ts'

const msg = (
  id: string,
  role: ChatMessage['role'] = 'user',
  content = id,
): ChatMessage => ({
  id,
  role,
  content,
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

test('web search switches on and off per thread, leaving no key when off', () => {
  const on = reducer(base(), { type: 'set-web-search', threadId: 'b1', on: true })
  assert.equal(on.threads.b1.webSearch, true)
  assert.equal(reducer(on, { type: 'set-web-search', threadId: 'b1', on: true }), on)
  const off = reducer(on, { type: 'set-web-search', threadId: 'b1', on: false })
  assert.deepEqual(off.threads.b1, base().threads.b1)
  assert.equal('webSearch' in off.threads.b1, false)
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

function conversation(): TreeState {
  return {
    threads: {
      root: {
        id: 'root',
        parentId: null,
        anchor: null,
        messages: [
          msg('u1', 'user', 'hello'),
          msg('a1', 'assistant', 'hi there'),
          msg('u2', 'user', 'again'),
          msg('a2', 'assistant', 'ok'),
        ],
        createdAt: 0,
        rev: 0,
      },
      b1: thread('b1', 'root', ['x']),
      b1a: thread('b1a', 'b1', ['y']),
      b2: {
        ...thread('b2', 'root'),
        anchor: { messageId: 'u2', start: 0, end: 5, quote: 'again' },
      },
    },
    rootId: 'root',
    activeThreadId: 'b1a',
    expanded: { root: 'b1', b1: 'b1a' },
  }
}

test('rewrite-thread retry trims the assistant tail and discards its branches', () => {
  const state = conversation()
  state.threads.b1 = {
    ...state.threads.b1,
    anchor: { messageId: 'a1', start: 0, end: 2, quote: 'hi' },
  }
  state.threads.b2 = {
    ...state.threads.b2,
    anchor: { messageId: 'u1', start: 0, end: 5, quote: 'hello' },
  }
  const before = state.threads.root.messages
  const messages = retryFromAssistant(before, 'a1')
  assert.ok(messages)
  const next = reducer(state, {
    type: 'rewrite-thread',
    threadId: 'root',
    messages,
    dropAnchorMessageIds: droppedMessageIds(before, messages),
  })
  assert.deepEqual(
    next.threads.root.messages.map((m) => m.id),
    ['u1'],
  )
  assert.equal(next.threads.root.rev, 0)
  assert.deepEqual(Object.keys(next.threads).sort(), ['b2', 'root'])
  assert.equal(next.activeThreadId, 'root')
  assert.equal(next.expanded.root, null)
})

test('rewrite-thread edit discards children on the edited message', () => {
  const state = conversation()
  const before = state.threads.root.messages
  const messages = editUserMessage(before, 'u2', 'edited')
  assert.ok(messages)
  const next = reducer(state, {
    type: 'rewrite-thread',
    threadId: 'root',
    messages,
    dropAnchorMessageIds: dropAnchorIdsForEdit(before, messages, 'u2'),
  })
  assert.deepEqual(
    next.threads.root.messages.map((m) => [m.id, m.content]),
    [
      ['u1', 'hello'],
      ['a1', 'hi there'],
      ['u2', 'edited'],
    ],
  )
  assert.ok(!next.threads.b2)
  assert.ok(next.threads.b1)
  assert.equal(next.threads.root.rev, 0)
})

test('rewrite-thread against a missing thread is inert', () => {
  const state = conversation()
  assert.equal(
    reducer(state, {
      type: 'rewrite-thread',
      threadId: 'gone',
      messages: [],
      dropAnchorMessageIds: [],
    }),
    state,
  )
})

test('undoing a takeaway preserves its branch and later conversation messages', () => {
  const state = conversation()
  const withTakeaway = reducer(state, {
    type: 'append-message', threadId: 'root',
    message: { id: 'takeaway', role: 'assistant', content: 'Insight', createdAt: 1, kind: 'drop-summary', sourceThreadId: 'b1' },
  })
  const withFollowup = reducer(withTakeaway, {
    type: 'append-message', threadId: 'root',
    message: { id: 'followup', role: 'user', content: 'Continue', createdAt: 2 },
  })
  const undone = reducer(withFollowup, { type: 'undo-takeaway', threadId: 'root', messageId: 'takeaway' })
  assert.equal(undone.threads.root.messages.at(-1)?.id, 'followup')
  assert.ok(!undone.threads.root.messages.some((message) => message.id === 'takeaway'))
  assert.equal(undone.threads.b1, state.threads.b1)
  assert.equal(undone.threads.b1a, state.threads.b1a)
  assert.equal(undone.threads.root.rev, withFollowup.threads.root.rev + 1)
  assert.equal(reducer(undone, { type: 'undo-takeaway', threadId: 'root', messageId: 'followup' }), undone)
})
