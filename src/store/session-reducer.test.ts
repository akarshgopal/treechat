import assert from 'node:assert/strict'
import test from 'node:test'
import { createEmptyState, createSeedState } from '../lib/seed.ts'
import { DEFAULT_SESSION_TITLE, MAX_SESSIONS } from '../lib/sessions.ts'
import { sessionReducer } from './session-reducer.ts'
import type { ChatMessage, ChatSession, SessionLibrary, TreeState } from '../types.ts'

const msg = (id: string, content = id): ChatMessage => ({
  id,
  role: 'user',
  content,
  createdAt: 0,
})

function session(
  id: string,
  treeState: TreeState = createEmptyState(),
  extra: Partial<ChatSession> = {},
): ChatSession {
  return {
    id,
    title: extra.title ?? DEFAULT_SESSION_TITLE,
    createdAt: extra.createdAt ?? 1,
    updatedAt: extra.updatedAt ?? 1,
    treeState,
    titleLocked: extra.titleLocked ?? false,
  }
}

function library(sessions: ChatSession[], activeSessionId = sessions[0]!.id): SessionLibrary {
  return { sessions, activeSessionId }
}

test('create-session adds an empty spine and keeps the others', () => {
  const seed = session('demo', createSeedState(), { title: 'What is TreeChat?' })
  const next = sessionReducer(library([seed]), { type: 'create-session' })
  assert.equal(next.sessions.length, 2)
  assert.ok(next.sessions.some((item) => item.id === 'demo'))
  const created = next.sessions.find((item) => item.id === next.activeSessionId)
  assert.ok(created)
  assert.notEqual(created.id, 'demo')
  assert.equal(created.title, DEFAULT_SESSION_TITLE)
  assert.deepEqual(created.treeState.threads[created.treeState.rootId]?.messages, [])
  const kept = next.sessions.find((item) => item.id === 'demo')
  assert.ok(
    kept?.treeState.threads[kept.treeState.rootId]?.messages.some(
      (message) => message.content === 'What is TreeChat?',
    ),
  )
})

test('switch-session moves to a known chat and ignores missing ids', () => {
  const a = session('a')
  const b = session('b')
  const state = library([a, b], 'a')
  assert.equal(
    sessionReducer(state, { type: 'switch-session', sessionId: 'b' }).activeSessionId,
    'b',
  )
  assert.equal(sessionReducer(state, { type: 'switch-session', sessionId: 'gone' }), state)
})

test('rename-session locks the title so later messages do not overwrite it', () => {
  const state = library([session('a')])
  const renamed = sessionReducer(state, {
    type: 'rename-session',
    sessionId: 'a',
    title: '  Project plan  ',
  })
  assert.equal(renamed.sessions[0]?.title, 'Project plan')
  assert.equal(renamed.sessions[0]?.titleLocked, true)

  const withMessage = sessionReducer(renamed, {
    type: 'tree',
    action: { type: 'append-message', threadId: renamed.sessions[0]!.treeState.rootId, message: msg('m1', 'A different prompt') },
  })
  assert.equal(withMessage.sessions[0]?.title, 'Project plan')
})

test('the first user message titles an unlocked chat', () => {
  const empty = createEmptyState()
  const state = library([session('a', empty)])
  const next = sessionReducer(state, {
    type: 'tree',
    action: {
      type: 'append-message',
      threadId: empty.rootId,
      message: msg('m1', 'How do sessions work?'),
    },
  })
  assert.equal(next.sessions[0]?.title, 'How do sessions work?')
  assert.equal(next.sessions[0]?.titleLocked, false)
})

test('delete-session removes that chat and leaves the others', () => {
  const state = library([session('a'), session('b'), session('c')], 'a')
  const next = sessionReducer(state, { type: 'delete-session', sessionId: 'b' })
  assert.deepEqual(
    next.sessions.map((item) => item.id).sort(),
    ['a', 'c'],
  )
  assert.equal(next.activeSessionId, 'a')
})

test('deleting the active chat focuses the most recently updated remaining one', () => {
  const state = library(
    [
      session('old', createEmptyState(), { updatedAt: 1 }),
      session('fresh', createEmptyState(), { updatedAt: 9 }),
      session('active', createEmptyState(), { updatedAt: 5 }),
    ],
    'active',
  )
  const next = sessionReducer(state, { type: 'delete-session', sessionId: 'active' })
  assert.equal(next.activeSessionId, 'fresh')
  assert.equal(next.sessions.length, 2)
})

test('deleting the last chat leaves a fresh empty session', () => {
  const next = sessionReducer(library([session('only')]), {
    type: 'delete-session',
    sessionId: 'only',
  })
  assert.equal(next.sessions.length, 1)
  assert.notEqual(next.sessions[0]?.id, 'only')
  assert.equal(next.sessions[0]?.title, DEFAULT_SESSION_TITLE)
  assert.deepEqual(next.sessions[0]?.treeState.threads[next.sessions[0].treeState.rootId]?.messages, [])
})

test('restoreDemo replaces only the active session tree', () => {
  const other = session('other', createEmptyState(), { title: 'Keep me' })
  const active = session('active', createEmptyState())
  const next = sessionReducer(library([other, active], 'active'), {
    type: 'tree',
    action: { type: 'restoreDemo' },
  })
  const demo = next.sessions.find((item) => item.id === 'active')
  const kept = next.sessions.find((item) => item.id === 'other')
  assert.ok(
    demo?.treeState.threads[demo.treeState.rootId]?.messages.some(
      (message) => message.content === 'What is TreeChat?',
    ),
  )
  assert.equal(demo?.title, 'What is TreeChat?')
  assert.deepEqual(kept?.treeState.threads[kept.treeState.rootId]?.messages, [])
  assert.equal(kept?.title, 'Keep me')
})

test('create-session past the cap drops the oldest non-active chat', () => {
  const sessions = Array.from({ length: MAX_SESSIONS }, (_, i) =>
    session(`s${i}`, createEmptyState(), { updatedAt: i, createdAt: i }),
  )
  const next = sessionReducer(library(sessions, 's0'), { type: 'create-session' })
  assert.equal(next.sessions.length, MAX_SESSIONS)
  assert.ok(next.sessions.some((item) => item.id === next.activeSessionId))
  assert.notEqual(next.activeSessionId, 's0')
  assert.ok(!next.sessions.some((item) => item.id === 's0'))
  assert.ok(next.sessions.some((item) => item.id === 's1'))
})
