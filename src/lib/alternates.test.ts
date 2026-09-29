import assert from 'node:assert/strict'
import test from 'node:test'
import { answerModel, answersOf, currentIndex, parseAlternates, switchAnswer } from './alternates.ts'
import { fromUIMessages, sameTranscript, toUIMessages } from './messages.ts'
import { parseSession } from './storage.ts'
import { createSeedState } from './seed.ts'
import type { ChatMessage } from '../types.ts'

const reply: ChatMessage = {
  id: 'a1',
  role: 'assistant',
  content: 'Third answer',
  createdAt: 3,
  usage: { promptTokens: 1, completionTokens: 2, model: 'anthropic/claude-sonnet-5' },
  alternates: [
    { content: 'First answer', createdAt: 1, citations: [{ id: '1', kind: 'web', title: 'A page', url: 'https://example.com' }] },
    { content: 'Second answer', createdAt: 2, model: 'x-ai/grok-4.7' },
  ],
}

test('the current answer is the message; the others sit around it in order', () => {
  assert.equal(currentIndex(reply), 2)
  assert.deepEqual(answersOf(reply).map((answer) => answer.content), ['First answer', 'Second answer', 'Third answer'])
  assert.equal(answerModel(answersOf(reply)[2]!), 'anthropic/claude-sonnet-5')
})

test('answers survive the chat engine, saving and export', () => {
  const switched = switchAnswer(reply, 1)
  const [round] = fromUIMessages(toUIMessages([switched]))
  assert.ok(sameTranscript([round!], [switched]))
  assert.deepEqual(round, { ...switched, kind: 'message', quote: undefined, sourceThreadId: undefined })
  assert.ok(!sameTranscript([switched], [reply]))

  const session = { id: 's', title: 'T', createdAt: 1, updatedAt: 1, titleLocked: true, treeState: createSeedState() }
  session.treeState.threads['thread-root']!.messages[1] = { ...switched, id: 'msg-root-2' }
  const parsed = parseSession(JSON.parse(JSON.stringify(session)))!
  assert.deepEqual(parsed.treeState.threads['thread-root']!.messages[1], { ...switched, id: 'msg-root-2', kind: 'message', quote: undefined, sourceThreadId: undefined })
})

test('broken stored answers are dropped, and a bad position falls back to last', () => {
  assert.deepEqual(parseAlternates('nope', 0), {})
  assert.deepEqual(parseAlternates([{ content: 1 }], 0), {})
  assert.deepEqual(parseAlternates([{ content: 'x', createdAt: 1 }], 5), { alternates: [{ content: 'x', createdAt: 1 }] })
})
