import assert from 'node:assert/strict'
import test from 'node:test'
import { editUserMessage } from '../lib/message-actions.ts'
import { prefixFingerprint } from '../lib/compaction.ts'
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

function withSummary(): TreeState {
  const state = base()
  const root = { ...state.threads.root, messages: ['r1', 'r2', 'r3', 'r4', 'r5'].map((id) => msg(id)) }
  return {
    ...state,
    threads: {
      ...state.threads,
      root: { ...root, summary: { content: 'r1 to r3', throughMessageId: 'r3', createdAt: 1 } },
    },
  }
}

test('a summary survives new messages and rewrites below what it covers', () => {
  const state = withSummary()
  const appended = reducer(state, {
    type: 'replace-messages',
    threadId: 'root',
    messages: [...state.threads.root.messages, msg('r6')],
  })
  assert.equal(appended.threads.root.summary?.throughMessageId, 'r3')
  const retried = reducer(state, {
    type: 'rewrite-thread',
    threadId: 'root',
    messages: state.threads.root.messages.slice(0, 4),
    dropAnchorMessageIds: ['r5'],
  })
  assert.equal(retried.threads.root.summary?.throughMessageId, 'r3')
})

test('a summary lands only on the messages it was written from', () => {
  const state = base()
  const root = { ...state.threads.root, messages: ['r1', 'r2', 'r3'].map((id) => msg(id)) }
  const current: TreeState = { ...state, threads: { ...state.threads, root } }
  const summary = { content: 's', throughMessageId: 'r2', createdAt: 1 }
  const basis = prefixFingerprint(root.messages, 'r2')!
  const set = reducer(current, { type: 'set-summary', threadId: 'root', summary, basis })
  assert.deepEqual(set.threads.root.summary, summary)
  // No remount: the engine keeps its in-flight state.
  assert.equal(set.threads.root.rev, root.rev)

  const edited = reducer(current, {
    type: 'rewrite-thread',
    threadId: 'root',
    messages: editUserMessage(root.messages, 'r2', 'changed')!,
    dropAnchorMessageIds: [],
  })
  assert.equal(reducer(edited, { type: 'set-summary', threadId: 'root', summary, basis }), edited)
})
