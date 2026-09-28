import assert from 'node:assert/strict'
import test from 'node:test'
import { createSeedState } from './seed.ts'
import { parseSession } from './storage.ts'
import { isThreadVisible, setVisibleThreads, unreadCount } from './unread.ts'
import { sessionReducer } from '../store/session-reducer.ts'
import type { ChatSession, SessionLibrary } from '../types.ts'

const chat = (id: string): ChatSession => ({ id, title: id, createdAt: 1, updatedAt: 1, titleLocked: true, treeState: createSeedState() })
const library = (active = 'a'): SessionLibrary => ({ sessions: [chat('a'), chat('b')], activeSessionId: active })
const tree = (state: SessionLibrary, id: string) => state.sessions.find((session) => session.id === id)!.treeState
const markUnread = (threadId: string, sessionId: string) => ({ type: 'tree' as const, action: { type: 'mark-unread' as const, threadId }, sessionId })

test('a finished reply is flagged new in its own chat; reading clears only what was shown', () => {
  let state = library()
  state = sessionReducer(state, markUnread('thread-branch-1', 'a'))
  state = sessionReducer(state, markUnread('thread-branch-1-1', 'a'))
  state = sessionReducer(state, markUnread('thread-root', 'b'))
  assert.equal(unreadCount(tree(state, 'a')), 2)
  assert.equal(unreadCount(tree(state, 'b')), 1)

  const before = state
  state = sessionReducer(state, { type: 'mark-read', sessionId: 'a', threadIds: ['thread-branch-1-1', 'thread-root'] })
  assert.deepEqual(Object.values(tree(state, 'a').threads).filter((thread) => thread.unread).map((thread) => thread.id), ['thread-branch-1'])
  // Reading is not activity: the chat keeps its place in the list.
  assert.equal(state.sessions[0]!.updatedAt, before.sessions[0]!.updatedAt)
  assert.equal(sessionReducer(state, { type: 'mark-read', sessionId: 'a', threadIds: ['thread-root'] }), state)
})

test('only lanes actually shown count as seen, and nothing while the tab is hidden', () => {
  setVisibleThreads('a', ['thread-branch-1'])
  assert.equal(isThreadVisible('a', 'thread-branch-1'), true)
  // An ancestor folded into a strip, or hidden on a phone, is not on screen.
  assert.equal(isThreadVisible('a', 'thread-root'), false)
  assert.equal(isThreadVisible('b', 'thread-branch-1'), false)
  setVisibleThreads('a', [])
  assert.equal(isThreadVisible('a', 'thread-branch-1'), false)
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
