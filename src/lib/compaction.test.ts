import assert from 'node:assert/strict'
import test from 'node:test'
import {
  planCompaction,
  SUMMARY_KEEP_RECENT,
  SUMMARY_TRIGGER_TOKENS,
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
