import assert from 'node:assert/strict'
import test from 'node:test'
import { bm25Scores } from './keyword.ts'

test('bm25 ranks the chunk that mentions the query terms first', () => {
  const texts = [
    'Bananas are yellow and grow in bunches.',
    'The deploy pipeline pushes the static site to GitHub Pages.',
    'Pages of a book are numbered.',
  ]
  const scores = bm25Scores('How does the site deploy to GitHub Pages?', texts)
  assert.equal(scores.indexOf(Math.max(...scores)), 1)
  assert.equal(scores[0], 0)
  assert.ok(scores[2]! > 0 && scores[2]! < scores[1]!)
})
