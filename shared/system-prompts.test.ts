import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSystemPrompts } from './system-prompts.ts'

test('root thread gets only the product prompt', () => {
  const prompts = buildSystemPrompts({})
  assert.equal(prompts.length, 1)
  assert.match(prompts[0]!, /TreeChat/)
  assert.doesNotMatch(prompts[0]!, /SELECTED QUOTE/)
})

test('empty quote and context stay on the main prompt', () => {
  const prompts = buildSystemPrompts({ quote: '', context: '  ' })
  assert.equal(prompts.length, 1)
})

test('quote-only side-thread adds SELECTED QUOTE chain', () => {
  const prompts = buildSystemPrompts({ quote: 'a moss underline' })
  assert.equal(prompts.length, 2)
  assert.match(prompts[1]!, /MAIN/)
  assert.match(prompts[1]!, /BRANCH depth N/)
  assert.match(prompts[1]!, /SELECTED QUOTE/)
  assert.match(prompts[1]!, /«a moss underline»/)
  assert.match(prompts[1]!, /side-thread/)
})

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
