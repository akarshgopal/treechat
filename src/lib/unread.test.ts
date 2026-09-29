import assert from 'node:assert/strict'
import test from 'node:test'
import { createSeedState } from './seed.ts'
import { parseSession } from './storage.ts'
import { isThreadVisible, setVisibleThreads } from './unread.ts'
import type { ChatSession } from '../types.ts'

const chat = (id: string): ChatSession => ({ id, title: id, createdAt: 1, updatedAt: 1, titleLocked: true, treeState: createSeedState() })

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
