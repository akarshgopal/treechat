import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSystemPrompts, SUMMARY_SECTION } from './system-prompts.ts'

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

test('a running summary is its own last system section', () => {
  const main = buildSystemPrompts({ summary: 'We picked Postgres.' })
  assert.equal(main.length, 2)
  assert.ok(main[1]!.startsWith(`${SUMMARY_SECTION}\nWe picked Postgres.`))

  const branch = buildSystemPrompts({ quote: 'pin', context: 'MAIN\nhi\n\nSELECTED QUOTE\n«pin»', summary: 'Earlier.' })
  assert.equal(branch.length, 3)
  assert.match(branch[1]!, /SELECTED QUOTE/)
  assert.match(branch[2]!, new RegExp(SUMMARY_SECTION))
  // The prefix before the summary does not depend on it (prompt caching).
  assert.deepEqual(branch.slice(0, 2), buildSystemPrompts({ quote: 'pin', context: 'MAIN\nhi\n\nSELECTED QUOTE\n«pin»' }))
  assert.equal(buildSystemPrompts({ summary: '  ' }).length, 1)
})

test('retrieved document excerpts come last, on the root and in branches', () => {
  const documents = 'DOCUMENTS\n\n[1] notes.md\n"""\nexcerpt\n"""'
  const root = buildSystemPrompts({ documents })
  assert.equal(root.length, 2)
  assert.equal(root[1], documents)
  const branch = buildSystemPrompts({ quote: 'pin', documents })
  assert.equal(branch.length, 3)
  assert.match(branch[1]!, /SELECTED QUOTE/)
  assert.equal(branch[2], documents)
  assert.equal(buildSystemPrompts({ documents: '   ' }).length, 1)
})
