import assert from 'node:assert/strict'
import test from 'node:test'
import {
  doomedIdsForAnchors,
  droppedMessageIds,
  retryFromAssistant,
  retryFromUser,
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

test('doomedIdsForAnchors includes nested descendants of those children', () => {
  const state = tree()
  assert.deepEqual(doomedIdsForAnchors(state, 'root', ['a1']).sort(), ['b1', 'b1a'])
})
