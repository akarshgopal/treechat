import assert from 'node:assert/strict'
import test from 'node:test'
import { chunkBlocks } from './chunk.ts'

const sentence = (index: number) => `Sentence ${index} is about topic ${index % 7} in some detail.`
const paragraph = (count: number, offset = 0) =>
  Array.from({ length: count }, (_, index) => sentence(index + offset)).join(' ')

test('consecutive chunks overlap by up to `overlap` characters', () => {
  const chunks = chunkBlocks('doc', [{ text: paragraph(40) }], { size: 400, overlap: 120 })
  for (let index = 1; index < chunks.length; index += 1) {
    const previous = chunks[index - 1]!.text
    const firstSentence = chunks[index]!.text.split(/(?<=\.) /)[0]!
    assert.ok(previous.includes(firstSentence), `chunk ${index} repeats the end of chunk ${index - 1}`)
    assert.ok(firstSentence.length <= 120)
  }
})

test('a sentence longer than the chunk is cut at word boundaries', () => {
  const words = Array.from({ length: 200 }, (_, index) => `word${index}`).join(' ')
  const chunks = chunkBlocks('doc', [{ text: words }], { size: 200, overlap: 0 })
  assert.ok(chunks.length > 1)
  for (const chunk of chunks) assert.match(chunk.text, /^word\d+( word\d+)*$/)
})

test('PDF chunks carry page locators and break at page changes once half full', () => {
  const chunks = chunkBlocks('pdf', [
    { text: paragraph(8), page: 1 },
    { text: paragraph(12, 8), page: 2 },
    { text: 'Tiny closing line.', page: 3 },
  ], { size: 800, overlap: 150 })
  assert.equal(chunks[0]!.locator, 'p. 1')
  assert.equal(chunks[0]!.page, 1)
  assert.doesNotMatch(chunks[0]!.text, /Sentence 8 /, 'page 2 starts a new chunk')
  assert.ok(chunks.slice(1).some((chunk) => chunk.locator === 'p. 2'))
  const last = chunks.at(-1)!
  assert.match(last.text, /Tiny closing line\.$/)
  assert.equal(last.locator, 'p. 3')
  assert.match(last.text, /^Sentence \d+/, 'overlap carries across pages')
})

test('short pages merge into one chunk with a page range', () => {
  const chunks = chunkBlocks('pdf', [
    { text: 'Page one is short.', page: 1 },
    { text: 'Page two is short too.', page: 2 },
  ])
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0]!.locator, 'pp. 1–2')
  assert.equal(chunks[0]!.page, 1)
})

test('every heading starts a chunk, however short the section', () => {
  const chunks = chunkBlocks('md', [
    { text: '# A\n\nShort.', heading: 'A' },
    { text: '# B\n\nAlso short.', heading: 'B' },
  ])
  assert.deepEqual(chunks.map((chunk) => [chunk.locator, chunk.text]), [['A', '# A\n\nShort.'], ['B', '# B\n\nAlso short.']])
})

test('markdown chunks carry their heading and do not overlap across sections', () => {
  const chunks = chunkBlocks('md', [
    { text: `# Intro\n\n${paragraph(10)}`, heading: 'Intro' },
    { text: `## Setup\n\n${paragraph(10, 50)}`, heading: 'Setup' },
  ])
  const setup = chunks.find((chunk) => chunk.heading === 'Setup')!
  assert.equal(setup.locator, 'Setup')
  assert.match(setup.text, /^## Setup/)
  assert.equal(chunks[0]!.locator, 'Intro')
})
