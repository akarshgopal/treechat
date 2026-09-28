import assert from 'node:assert/strict'
import test from 'node:test'
import { mockChatStream } from './mock-stream.ts'
import { collectAssistantText } from './client-chat.ts'
import { LEARN_REQUEST, learnFileName, learnPrompt, learnScope } from './learn.ts'
import { createSeedState } from './seed.ts'

function seeded() {
  const state = createSeedState()
  state.threads['thread-root']!.messages.push({
    id: 'takeaway-1', role: 'assistant', content: 'A branch stays pinned to its passage.', createdAt: 9, kind: 'drop-summary', sourceThreadId: 'thread-branch-1',
  })
  return state
}

test('on the main thread the scope is the whole chat; in a branch, it and its subtree', () => {
  const state = seeded()
  assert.deepEqual(learnScope(state, 'thread-root', 'What is TreeChat?'), {
    threadId: 'thread-root', title: 'What is TreeChat?', threadIds: ['thread-root', 'thread-branch-1', 'thread-branch-1-1'],
  })
  const branch = learnScope(state, 'thread-branch-1-1', 'What is TreeChat?')
  assert.deepEqual(branch.threadIds, ['thread-branch-1-1'])
  assert.equal(branch.title, 'So how deep does this actually go?')
})

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

test('the demo answers with a lead, the takeaways and the rest, every time the same', async () => {
  const state = seeded()
  const prompt = learnPrompt(state, learnScope(state, 'thread-root', 'What is TreeChat?'))
  const run = () => collectAssistantText(mockChatStream({ messages: [{ role: 'user', content: prompt }], threadId: 't', runId: 'r', pace: false }))
  const text = await run()
  assert.equal(text, await run())
  assert.match(text, /^This demo summary covers “What is TreeChat\?” and its 2 branches\./)
  assert.ok(text.includes('## Takeaways\n- **If I keep talking on the main thread, does this branch lose its…** A branch stays pinned to its passage.'))
  assert.ok(text.includes('## Also explored\n- So how deep does this actually go?'))
})

test('the summary file is named after its title', () => {
  assert.equal(learnFileName('Why is the sky blue?'), 'why-is-the-sky-blue-what-i-learned.md')
})
