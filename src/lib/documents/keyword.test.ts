import assert from 'node:assert/strict'
import test from 'node:test'
import { cosine, fakeEmbedder } from './embedder.ts'
import { bm25Scores, tokenize } from './keyword.ts'

test('tokenize lowercases, drops stop words, and stems plurals', () => {
  assert.deepEqual(tokenize('The Documents are stored in IndexedDB!'), ['document', 'stored', 'indexeddb'])
  assert.deepEqual(tokenize('Libraries, boxes, glass'), ['library', 'box', 'glass'])
})

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

test('bm25 with no usable query terms scores nothing', () => {
  assert.deepEqual(bm25Scores('the of and', ['anything at all']), [0])
})

test('the fake embedder is deterministic, unit length, and word-sensitive', async () => {
  const [a, b, c] = await fakeEmbedder.embed(['moss underline branch', 'branch underline moss', 'weather forecast rain'])
  assert.equal(a!.length, 256)
  assert.ok(Math.abs(cosine(a!, a!) - 1) < 1e-6)
  assert.ok(Math.abs(cosine(a!, b!) - 1) < 1e-6, 'bag of words ignores order')
  assert.ok(cosine(a!, c!) < 0.2)
  const [again] = await fakeEmbedder.embed(['moss underline branch'])
  assert.deepEqual(again, a)
})
