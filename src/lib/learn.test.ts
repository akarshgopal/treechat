import assert from 'node:assert/strict'
import test from 'node:test'
import { LEARN_REQUEST, learnPrompt, learnScope } from './learn.ts'
import { createSeedState } from './seed.ts'

function seeded() {
  const state = createSeedState()
  state.threads['thread-root']!.messages.push({
    id: 'takeaway-1', role: 'assistant', content: 'A branch stays pinned to its passage.', createdAt: 9, kind: 'drop-summary', sourceThreadId: 'thread-branch-1',
  })
  return state
}

test('the request outlines the scope with titles, quotes and takeaways', () => {
  const state = seeded()
  const prompt = learnPrompt(state, learnScope(state, 'thread-root', 'What is TreeChat?'))
  assert.ok(prompt.startsWith(LEARN_REQUEST))
  assert.ok(prompt.includes('"## Takeaways"') && prompt.includes('"## Also explored"'))
  assert.ok(prompt.includes('TITLE: What is TreeChat?'))
  assert.ok(prompt.includes('BRANCH: If I keep talking on the main thread'))
  assert.ok(prompt.includes('  BRANCH: So how deep does this actually go?'))
  assert.ok(prompt.includes('TAKEAWAY: A branch stays pinned to its passage.'))
  // Listed with its branch, not repeated as part of the main transcript.
  assert.equal(prompt.split('A branch stays pinned to its passage.').length, 2)
})
