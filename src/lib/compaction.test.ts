import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applySummaryToRequest,
  compactTranscript,
  estimateTokens,
  planCompaction,
  prefixFingerprint,
  SUMMARY_KEEP_RECENT,
  SUMMARY_TRIGGER_TOKENS,
  summaryHolds,
} from './compaction.ts'
import type { ChatMessage, ThreadSummary } from '../types.ts'

const msg = (id: string, role: ChatMessage['role'], content: string): ChatMessage => ({
  id,
  role,
  content,
  createdAt: 0,
})

/** Alternating user/assistant turns, each about `tokens` estimated tokens. */
function conversation(count: number, tokens = 500): ChatMessage[] {
  return Array.from({ length: count }, (_, i) =>
    msg(`m${i}`, i % 2 === 0 ? 'user' : 'assistant', `${i}:`.padEnd(tokens * 4, 'x')))
}

const summaryThrough = (id: string, content = 'earlier: x'): ThreadSummary => ({
  content,
  throughMessageId: id,
  createdAt: 1,
})

test('estimateTokens is about four characters a token', () => {
  assert.equal(estimateTokens(''), 0)
  assert.equal(estimateTokens('abcd'), 1)
  assert.equal(estimateTokens('abcde'), 2)
})

test('short threads are never summarized', () => {
  assert.equal(planCompaction(conversation(8), undefined), null)
  // Lots of tokens, but all of it recent.
  assert.equal(planCompaction(conversation(SUMMARY_KEEP_RECENT, 10_000), undefined), null)
})

test('older history past the trigger is summarized, keeping the recent turns', () => {
  const messages = conversation(30)
  const plan = planCompaction(messages, undefined)
  assert.ok(plan)
  assert.equal(plan.previous, undefined)
  // 30 - 6 = 24 is a user turn, so everything before it is folded in.
  assert.equal(plan.messages.length, 24)
  assert.equal(plan.throughMessageId, 'm23')
  assert.equal(messages[24].role, 'user')
})

test('the kept tail always opens on a user turn', () => {
  const messages = conversation(31)
  const plan = planCompaction(messages, undefined)
  assert.ok(plan)
  const next = messages[messages.findIndex((m) => m.id === plan.throughMessageId) + 1]
  assert.equal(next.role, 'user')
  assert.ok(messages.length - plan.messages.length >= SUMMARY_KEEP_RECENT)
})

test('the trigger counts only what the summary does not cover yet', () => {
  const messages = conversation(30)
  // Summary through m15: 16..23 (8 × ~500 tokens) is under the trigger.
  assert.equal(planCompaction(messages, summaryThrough('m15')), null)
  const longer = conversation(50)
  const plan = planCompaction(longer, summaryThrough('m15', 'so far'))
  assert.ok(plan)
  assert.equal(plan.previous, 'so far')
  assert.equal(plan.messages[0].id, 'm16')
  assert.equal(plan.throughMessageId, 'm43')
  assert.ok(plan.messages.length * 500 >= SUMMARY_TRIGGER_TOKENS)
})

test('a summary that no longer matches the thread is replaced from the start', () => {
  const plan = planCompaction(conversation(30), summaryThrough('gone'))
  assert.ok(plan)
  assert.equal(plan.previous, undefined)
  assert.equal(plan.messages[0].id, 'm0')
})

test('one pass is capped and ends before a user turn', () => {
  const messages = conversation(40, 8000)
  // Three ~8k-token messages fit; the cut backs off so a user turn comes next.
  const plan = planCompaction(messages, undefined, { maxInputTokens: 30_000 })
  assert.ok(plan)
  assert.equal(plan.messages.length, 2)
  assert.equal(plan.throughMessageId, 'm1')
  // The next pass continues from there.
  const next = planCompaction(messages, summaryThrough('m1'), { maxInputTokens: 30_000 })
  assert.equal(next?.messages[0].id, 'm2')
})

test('summaryHolds survives appends and drops on rewrites of covered messages', () => {
  const before = conversation(12)
  const summary = summaryThrough('m5')
  assert.ok(summaryHolds(before, [...before, msg('new', 'user', 'hi')], summary))
  // Retry below the summary: truncation after the covered prefix.
  assert.ok(summaryHolds(before, before.slice(0, 9), summary))
  // Retry or edit that truncates into the covered prefix.
  assert.equal(summaryHolds(before, before.slice(0, 4), summary), false)
  // Edit & resend of the covered message itself keeps its id but not its text.
  const edited = before.slice(0, 6)
  edited[5] = { ...edited[5], content: 'changed' }
  assert.equal(summaryHolds(before, edited, summary), false)
  // A covered message removed from the middle.
  assert.equal(summaryHolds(before, before.filter((m) => m.id !== 'm2'), summary), false)
})

test('prefixFingerprint changes when a covered message changes', () => {
  const messages = conversation(8)
  const basis = prefixFingerprint(messages, 'm3')
  assert.ok(basis)
  assert.equal(prefixFingerprint([...messages, msg('x', 'user', 'y')], 'm3'), basis)
  const edited = messages.map((m) => (m.id === 'm1' ? { ...m, content: 'other' } : m))
  assert.notEqual(prefixFingerprint(edited, 'm3'), basis)
  assert.equal(prefixFingerprint(messages, 'missing'), null)
})

test('a summarized request sends the summary and only the later messages', () => {
  const messages = [
    { id: 'a', role: 'user', content: 'one' },
    { id: 'b', role: 'assistant', content: 'two' },
    { id: 'c', role: 'user', content: 'three' },
  ]
  const out = applySummaryToRequest(messages, {
    quote: 'q',
    threadSummary: { content: 'we said one and two', throughMessageId: 'b' },
  })
  assert.deepEqual(out.messages, [messages[2]])
  assert.deepEqual(out.forwardedProps, { quote: 'q', summary: 'we said one and two' })
})

test('a summary that does not match the request is dropped, not half-applied', () => {
  const messages = [
    { id: 'a', role: 'user', content: 'one' },
    { id: 'b', role: 'assistant', content: 'two' },
  ]
  const missing = applySummaryToRequest(messages, {
    threadSummary: { content: 's', throughMessageId: 'gone' },
  })
  assert.equal(missing.messages, messages)
  assert.deepEqual(missing.forwardedProps, {})
  // Covering the last message would leave nothing to answer.
  const last = applySummaryToRequest(messages, {
    threadSummary: { content: 's', throughMessageId: 'b' },
  })
  assert.equal(last.messages, messages)
  assert.deepEqual(last.forwardedProps, {})
  // A stray string summary never leaks through on its own.
  assert.deepEqual(applySummaryToRequest(messages, { summary: 'stale' }).forwardedProps, {})
})

test('compactTranscript puts the summary in place of what it covers', () => {
  const messages = conversation(4, 1)
  assert.equal(compactTranscript({ messages }).split('\n\n').length, 4)
  const text = compactTranscript({ messages, summary: summaryThrough('m1', 'S') })
  assert.equal(text, `Earlier, summarized:\nS\n\nuser: ${messages[2].content}\n\nassistant: ${messages[3].content}`)
})
