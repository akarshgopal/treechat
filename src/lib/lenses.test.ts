import assert from 'node:assert/strict'
import test from 'node:test'
import { snapOffsetsToWords } from './selection.ts'

test('snapOffsetsToWords drops edge punctuation and unpaired quotes', () => {
  const slice = (text: string, start: number, end: number) => {
    const snapped = snapOffsetsToWords(text, start, end)
    return text.slice(snapped.start, snapped.end)
  }
  const text = 'Highlight text in any message, in any thread.'
  assert.equal(slice(text, 0, 30), 'Highlight text in any message')
  assert.equal(slice(text, 29, text.length), 'in any thread')
  assert.equal(slice('tap “Explain” now', 4, 12), 'Explain')
  assert.equal(slice('tap “Explain” now', 4, 13), '“Explain”')
  assert.equal(slice('is it (really) so?', 6, 18), '(really) so?')
  assert.equal(slice('a, b', 1, 2), ',')
})

test('snapOffsetsToWords keeps contractions and hyphenated words whole', () => {
  const text = "it's well-known"
  const { start, end } = snapOffsetsToWords(text, 1, 9)
  assert.equal(text.slice(start, end), "it's well-known")
})
