import assert from 'node:assert/strict'
import test from 'node:test'
import {
  childIdsAnchoredToMessages,
  doomedIdsForAnchors,
  dropAnchorIdsForEdit,
  droppedMessageIds,
  editUserMessage,
  retryFromAssistant,
  retryFromUser,
  truncateAfterMessage,
} from './message-actions.ts'
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

const thread = (
  id: string,
  parentId: string | null,
  messages: ChatMessage[],
  anchor?: Thread['anchor'],
): Thread => ({
  id,
  parentId,
  anchor: parentId
    ? (anchor ?? { messageId: 'u1', start: 0, end: 3, quote: 'abc' })
    : null,
  messages,
  createdAt: 0,
  rev: 0,
})

function tree(): TreeState {
  return {
    threads: {
      root: thread('root', null, [
        msg('u1', 'user', 'hello'),
        msg('a1', 'assistant', 'hi'),
        msg('u2', 'user', 'again'),
        msg('a2', 'assistant', 'ok'),
      ]),
      b1: thread('b1', 'root', [msg('bx')], {
        messageId: 'a1',
        start: 0,
        end: 2,
        quote: 'hi',
      }),
      b1a: thread('b1a', 'b1', [msg('by')], {
        messageId: 'bx',
        start: 0,
        end: 2,
        quote: 'bx',
      }),
      b2: thread('b2', 'root', [], {
        messageId: 'u2',
        start: 0,
        end: 5,
        quote: 'again',
      }),
    },
    rootId: 'root',
    activeThreadId: 'root',
    expanded: { root: 'b1', b1: 'b1a' },
  }
}

test('truncateAfterMessage keeps the target and drops the tail', () => {
  const messages = tree().threads.root.messages
  assert.deepEqual(
    truncateAfterMessage(messages, 'u2')?.map((m) => m.id),
    ['u1', 'a1', 'u2'],
  )
  assert.equal(truncateAfterMessage(messages, 'gone'), null)
})

test('retryFromAssistant trims from the prior user turn', () => {
  const messages = tree().threads.root.messages
  assert.deepEqual(
    retryFromAssistant(messages, 'a2')?.map((m) => m.id),
    ['u1', 'a1', 'u2'],
  )
  assert.deepEqual(
    retryFromAssistant(messages, 'a1')?.map((m) => m.id),
    ['u1'],
  )
})

test('retryFromAssistant is inert on user turns and missing ids', () => {
  const messages = tree().threads.root.messages
  assert.equal(retryFromAssistant(messages, 'u2'), null)
  assert.equal(retryFromAssistant(messages, 'gone'), null)
  assert.equal(retryFromAssistant([msg('a1', 'assistant')], 'a1'), null)
})

test('regenerating a user turn preserves its anchors and removes only later turns', () => {
  const state = tree()
  const before = state.threads.root.messages
  const after = retryFromUser(before, 'u2')!
  assert.deepEqual(after.map((message) => message.id), ['u1', 'a1', 'u2'])
  assert.equal(after.at(-1), before[2])
  assert.deepEqual(droppedMessageIds(before, after), ['a2'])
  assert.deepEqual(doomedIdsForAnchors(state, 'root', droppedMessageIds(before, after)), [])
  assert.deepEqual(retryFromUser(after, 'u2'), after)
  assert.equal(retryFromUser(before, 'a2'), null)
  assert.equal(retryFromUser(before, 'missing'), null)
})

test('editUserMessage rewrites content and truncates subsequent turns', () => {
  const messages = tree().threads.root.messages
  const next = editUserMessage(messages, 'u1', 'hello there')
  assert.ok(next)
  assert.deepEqual(
    next.map((m) => [m.id, m.content]),
    [['u1', 'hello there']],
  )
  assert.equal(editUserMessage(messages, 'a1', 'nope'), null)
  assert.equal(editUserMessage(messages, 'gone', 'nope'), null)
})

test('droppedMessageIds lists ids that did not survive a rewrite', () => {
  const before = tree().threads.root.messages
  const after = retryFromAssistant(before, 'a1') ?? []
  assert.deepEqual(droppedMessageIds(before, after), ['a1', 'u2', 'a2'])
})

test('dropAnchorIdsForEdit includes the edited message itself', () => {
  const before = tree().threads.root.messages
  const after = editUserMessage(before, 'u2', 'edited') ?? []
  assert.deepEqual(dropAnchorIdsForEdit(before, after, 'u2').sort(), ['a2', 'u2'])
})

test('childIdsAnchoredToMessages finds direct children on those messages', () => {
  const state = tree()
  assert.deepEqual(childIdsAnchoredToMessages(state, 'root', ['a1']), ['b1'])
  assert.deepEqual(
    childIdsAnchoredToMessages(state, 'root', ['a1', 'u2']).sort(),
    ['b1', 'b2'],
  )
  assert.deepEqual(childIdsAnchoredToMessages(state, 'root', ['u1']), [])
})

test('doomedIdsForAnchors includes nested descendants of those children', () => {
  const state = tree()
  assert.deepEqual(doomedIdsForAnchors(state, 'root', ['a1']).sort(), ['b1', 'b1a'])
})
