import assert from 'node:assert/strict'
import test from 'node:test'
import {
  locateSnippet,
} from './source-content.ts'



test('snippets are found despite case, whitespace and typographic quotes', () => {
  const text = 'Intro.  The Cited\n  words — “quoted” here.'
  const found = locateSnippet(text, 'the cited words - "quoted"')
  assert.ok(found)
  assert.equal(text.slice(found.start, found.end), 'The Cited\n  words — “quoted”')
  assert.equal(locateSnippet(text, 'absent'), null)
  assert.equal(locateSnippet(text, undefined), null)
  // A long quote that drifts from the page still lands on its opening words.
  const long = locateSnippet('one two three four five six seven eight nine ten', 'one two three four five six seven eight NOT HERE')
  assert.deepEqual(long, { start: 0, end: 'one two three four five six seven eight'.length })
})
