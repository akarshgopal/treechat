import assert from 'node:assert/strict'
import test from 'node:test'
import { LENSES, LENS_QUOTE_CHARS, lensQuestion } from './lenses.ts'
import { snapOffsetsToWords } from './selection.ts'

test('every lens asks about the quote and ids are unique', () => {
  assert.equal(new Set(LENSES.map((lens) => lens.id)).size, LENSES.length)
  for (const lens of LENSES) assert.match(lensQuestion(lens, 'knowledge cutoff'), /“knowledge cutoff”/)
})

test('lens questions clip long quotes so branch titles stay readable', () => {
  const question = lensQuestion(LENSES[0]!, 'word '.repeat(40))
  const quoted = question.slice(question.indexOf('“') + 1, question.indexOf('”'))
  assert.ok(quoted.length <= LENS_QUOTE_CHARS)
  assert.ok(quoted.endsWith('…'))
})

test('lens questions do not double quote marks already on the passage', () => {
  assert.equal(lensQuestion(LENSES[0]!, '“knowledge cutoff”'), 'Explain “knowledge cutoff”')
  assert.equal(lensQuestion(LENSES[0]!, '"Expand" gives room'), 'Explain “Expand" gives room”')
})

test('snapOffsetsToWords widens a selection that cuts words', () => {
  const text = 'a GLM 5.x series could exist without me'
  const start = text.indexOf('ries')
  const end = text.indexOf('without') + 'with'.length
  const snapped = snapOffsetsToWords(text, start, end)
  assert.equal(text.slice(snapped.start, snapped.end), 'series could exist without')
})

test('snapOffsetsToWords leaves whole-word and whitespace boundaries alone', () => {
  const text = 'one two three'
  assert.deepEqual(snapOffsetsToWords(text, 4, 7), { start: 4, end: 7 })
  assert.deepEqual(snapOffsetsToWords(text, 3, 8), { start: 3, end: 8 })
  assert.deepEqual(snapOffsetsToWords(text, 5, 5), { start: 5, end: 5 })
})

test('snapOffsetsToWords keeps contractions and hyphenated words whole', () => {
  const text = "it's well-known"
  const { start, end } = snapOffsetsToWords(text, 1, 9)
  assert.equal(text.slice(start, end), "it's well-known")
})
