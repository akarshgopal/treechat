import assert from 'node:assert/strict'
import test from 'node:test'
import { createEmptyState, createSeedState } from './seed.ts'

test('createEmptyState is a single empty root thread', () => {
  const state = createEmptyState()
  assert.equal(Object.keys(state.threads).length, 1)
  const root = state.threads[state.rootId]
  assert.ok(root)
  assert.equal(root.parentId, null)
  assert.equal(root.anchor, null)
  assert.deepEqual(root.messages, [])
  assert.equal(state.activeThreadId, state.rootId)
  assert.deepEqual(state.expanded, {})
})

test('createSeedState still ships the demo walkthrough', () => {
  const state = createSeedState()
  const root = state.threads[state.rootId]
  assert.ok(root)
  assert.ok(root.messages.some((message) => message.content === 'What is TreeChat?'))
  assert.ok(Object.keys(state.threads).length > 1)
})
