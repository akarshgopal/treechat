import assert from 'node:assert/strict'
import test from 'node:test'
import { createEmptyState, createSeedState } from './seed.ts'
import {
  DEFAULT_SESSION_TITLE,
  MAX_SESSIONS,
  SESSION_TITLE_MAX,
  capSessions,
  normalizeSessionTitle,
  titleFromTree,
} from './sessions.ts'
import type { ChatMessage, ChatSession, TreeState } from '../types.ts'

const msg = (content: string, role: ChatMessage['role'] = 'user'): ChatMessage => ({
  id: content,
  role,
  content,
  createdAt: 0,
})

function withRootMessages(contents: ChatMessage[]): TreeState {
  const state = createEmptyState()
  const root = state.threads[state.rootId]
  return {
    ...state,
    threads: { ...state.threads, [root.id]: { ...root, messages: contents } },
  }
}

function session(id: string, updatedAt: number): ChatSession {
  return {
    id,
    title: id,
    createdAt: updatedAt,
    updatedAt,
    treeState: createEmptyState(),
    titleLocked: false,
  }
}

test('titleFromTree is New chat when the root has no user text', () => {
  assert.equal(titleFromTree(createEmptyState()), DEFAULT_SESSION_TITLE)
  assert.equal(
    titleFromTree(withRootMessages([msg('Hello from the model', 'assistant')])),
    DEFAULT_SESSION_TITLE,
  )
})

test('titleFromTree uses the first non-empty user message', () => {
  assert.equal(titleFromTree(createSeedState()), 'What is TreeChat?')
  assert.equal(
    titleFromTree(withRootMessages([msg('   '), msg('  Hello   world  ')])),
    'Hello world',
  )
})

test('normalizeSessionTitle clips to the title budget', () => {
  const long = 'x'.repeat(SESSION_TITLE_MAX + 12)
  const next = normalizeSessionTitle(`  ${long}  `)
  assert.equal(next.endsWith('…'), true)
  assert.ok(next.length <= SESSION_TITLE_MAX + 1)
  assert.equal(normalizeSessionTitle('   '), DEFAULT_SESSION_TITLE)
})

test('capSessions drops the oldest chats and never the kept id', () => {
  const sessions = Array.from({ length: MAX_SESSIONS + 3 }, (_, i) => session(`s${i}`, i))
  const next = capSessions(sessions, 's0')
  assert.equal(next.length, MAX_SESSIONS)
  assert.ok(next.some((item) => item.id === 's0'))
  assert.ok(!next.some((item) => item.id === 's1'))
  assert.ok(next.some((item) => item.id === `s${MAX_SESSIONS + 2}`))
})
