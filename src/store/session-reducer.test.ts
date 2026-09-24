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

test('set-session-documents attaches documents without reordering chats', () => {
  const state = library([session('a', createEmptyState(), { updatedAt: 5 }), session('b')])
  const next = sessionReducer(state, { type: 'set-session-documents', sessionId: 'a', documentIds: ['d1', 'd2', 'd1'] })
  assert.deepEqual(next.sessions[0]!.documentIds, ['d1', 'd2'])
  assert.equal(next.sessions[0]!.updatedAt, 5)
  assert.equal(next.sessions[1], state.sessions[1])
  // Same list: same state object.
  assert.equal(sessionReducer(next, { type: 'set-session-documents', sessionId: 'a', documentIds: ['d1', 'd2'] }), next)
  // Clearing removes the key, matching what storage reads back.
  const cleared = sessionReducer(next, { type: 'set-session-documents', sessionId: 'a', documentIds: [] })
  assert.equal('documentIds' in cleared.sessions[0]!, false)
})

test('restore-session brings a deleted chat back and opens it', () => {
  const kept = session('kept', createEmptyState(), { title: 'Kept', titleLocked: true })
  const gone = session('gone', createSeedState(), { title: 'Gone', titleLocked: true })
  const deleted = sessionReducer(library([kept, gone], 'gone'), { type: 'delete-session', sessionId: 'gone' })
  const restored = sessionReducer(deleted, { type: 'restore-session', session: gone })
  assert.deepEqual(restored.sessions.map((item) => item.id).sort(), ['gone', 'kept'])
  assert.equal(restored.activeSessionId, 'gone')
  assert.equal(sessionReducer(restored, { type: 'restore-session', session: gone }), restored)
})

test('restoring the only chat replaces the blank one its delete left behind', () => {
  const only = session('only', createSeedState(), { title: 'Only', titleLocked: true })
  const deleted = sessionReducer(library([only]), { type: 'delete-session', sessionId: 'only' })
  const restored = sessionReducer(deleted, { type: 'restore-session', session: only })
  assert.deepEqual(restored.sessions.map((item) => item.id), ['only'])
})
