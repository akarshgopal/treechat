import assert from 'node:assert/strict'
import test from 'node:test'
import { answerModel, answersOf, claimNextModel, currentIndex, parseAlternates, queueEarlierAnswers, restoredReply, runKeyOf, setNextModel, switchAnswer, takeEarlierAnswers, takeRunModel } from './alternates.ts'
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

test('switching swaps the answer in place and keeps every answer, with its sources and model', () => {
  const first = switchAnswer(reply, 0)
  assert.equal(first.id, 'a1')
  assert.equal(first.content, 'First answer')
  assert.equal(first.citations?.[0]?.title, 'A page')
  assert.equal(first.usage, undefined)
  assert.equal(currentIndex(first), 0)
  assert.deepEqual(answersOf(first).map((answer) => answer.content), ['First answer', 'Second answer', 'Third answer'])
  const second = switchAnswer(first, 1)
  assert.equal(second.model, 'x-ai/grok-4.7')
  assert.equal(second.citations, undefined)
  const back = switchAnswer(second, 2)
  assert.equal(back.content, 'Third answer')
  assert.equal(back.usage?.model, 'anthropic/claude-sonnet-5')
  assert.equal(switchAnswer(reply, 7), reply)
  assert.equal(switchAnswer(reply, 2), reply)
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

test('another model answers one request of one thread in one chat, and the run remembers which', () => {
  const a = runKeyOf('chat-a', 'thread-root')
  const b = runKeyOf('chat-b', 'thread-root')
  setNextModel(a, 'x-ai/grok-4.7')
  // Every chat's main thread shares an id; another chat's run takes nothing.
  assert.equal(claimNextModel(b), undefined)
  assert.equal(claimNextModel(a), 'x-ai/grok-4.7')
  assert.equal(claimNextModel(a), undefined)
  assert.equal(takeRunModel(a), undefined)
  setNextModel(a, 'x-ai/grok-4.7')
  claimNextModel(a)
  assert.equal(takeRunModel(b), undefined)
  assert.equal(takeRunModel(a), 'x-ai/grok-4.7')
})

test('a failed regenerate puts the reply back as it was, every answer included', () => {
  const key = runKeyOf('chat-a', 'thread-root')
  const shown = switchAnswer(reply, 1)
  queueEarlierAnswers(key, shown)
  assert.equal(takeEarlierAnswers(runKeyOf('chat-b', 'thread-root')), undefined)
  const earlier = takeEarlierAnswers(key)!
  assert.equal(takeEarlierAnswers(key), undefined)
  const back = restoredReply(earlier, 'restored')
  assert.deepEqual({ ...back, createdAt: 0 }, { ...shown, id: 'restored', createdAt: 0 })
  const single = restoredReply({ answers: [{ content: 'Only', createdAt: 5 }], index: 0 }, 'r')
  assert.deepEqual(single, { id: 'r', role: 'assistant', content: 'Only', createdAt: 5 })
})
