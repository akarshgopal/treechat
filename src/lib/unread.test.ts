import assert from 'node:assert/strict'
import test from 'node:test'
import { createSeedState } from './seed.ts'
import { parseSession } from './storage.ts'
import { unreadCount } from './unread.ts'
import { sessionReducer } from '../store/session-reducer.ts'
import type { ChatSession, SessionLibrary } from '../types.ts'

const chat = (id: string): ChatSession => ({ id, title: id, createdAt: 1, updatedAt: 1, titleLocked: true, treeState: createSeedState() })
const library = (active = 'a'): SessionLibrary => ({ sessions: [chat('a'), chat('b')], activeSessionId: active })
const tree = (state: SessionLibrary, id: string) => state.sessions.find((session) => session.id === id)!.treeState
const markUnread = (threadId: string, sessionId: string) => ({ type: 'tree' as const, action: { type: 'mark-unread' as const, threadId }, sessionId })

test('a reply finishing out of sight is new; on screen it is not', () => {
  let state = library()
  // Open chat, main thread framed: the nested branch is out of sight.
  state = sessionReducer(state, markUnread('thread-branch-1-1', 'a'))
  assert.equal(tree(state, 'a').threads['thread-branch-1-1']!.unread, true)
  const before = state
  assert.equal(sessionReducer(state, markUnread('thread-root', 'a')), before)
  // Any thread of a chat that is not open is out of sight.
  state = sessionReducer(state, markUnread('thread-root', 'b'))
  assert.equal(unreadCount(tree(state, 'a')), 1)
  assert.equal(unreadCount(tree(state, 'b')), 1)
})

test('opening a thread, or the chat it is framed in, reads it and the lanes above it', () => {
  let state = library()
  state = sessionReducer(state, markUnread('thread-branch-1', 'a'))
  state = sessionReducer(state, markUnread('thread-branch-1-1', 'a'))
  state = sessionReducer(state, { type: 'tree', action: { type: 'focus', threadId: 'thread-branch-1-1' } })
  assert.equal(unreadCount(tree(state, 'a')), 0)

  state = sessionReducer(state, markUnread('thread-root', 'b'))
  state = sessionReducer(state, markUnread('thread-branch-1', 'b'))
  state = sessionReducer(state, { type: 'switch-session', sessionId: 'b' })
  // Chat b opens on its main thread: the branch stays new.
  assert.deepEqual(Object.values(tree(state, 'b').threads).filter((thread) => thread.unread).map((thread) => thread.id), ['thread-branch-1'])
})

test('the flag is saved, exported and read back; anything but true is dropped', () => {
  const session = chat('a')
  session.treeState.threads['thread-branch-1']!.unread = true
  const parsed = parseSession(JSON.parse(JSON.stringify(session)))!
  assert.equal(parsed.treeState.threads['thread-branch-1']!.unread, true)
  assert.equal('unread' in parsed.treeState.threads['thread-root']!, false)
  const odd = JSON.parse(JSON.stringify(session))
  odd.treeState.threads['thread-branch-1'].unread = 'yes'
  assert.equal('unread' in parseSession(odd)!.treeState.threads['thread-branch-1']!, false)
})
