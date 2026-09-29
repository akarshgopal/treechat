import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSystemPrompts } from './system-prompts.ts'

test('context wins over a synthesized quote chain', () => {
  const chain = 'MAIN\nhello\n\nBRANCH depth 1\nmore\n\nSELECTED QUOTE\n«pin»'
  const prompts = buildSystemPrompts({ quote: 'ignored', context: chain })
  assert.equal(prompts.length, 2)
  assert.match(prompts[1]!, /MAIN/)
  assert.match(prompts[1]!, /BRANCH depth 1/)
  assert.match(prompts[1]!, /SELECTED QUOTE/)
  assert.match(prompts[1]!, /«pin»/)
  assert.doesNotMatch(prompts[1]!, /ignored/)
})
