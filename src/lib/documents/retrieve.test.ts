import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { setEmbedder } from './active-embedder.ts'
import { fakeEmbedder, type Embedder } from './embedder.ts'
import { indexFile } from './ingest.ts'
import { documentCitations, documentsPrompt, forgetCachedChunks, retrieve } from './retrieve.ts'

const broken: Embedder = { id: fakeEmbedder.id, threshold: 0.1, embed: () => Promise.reject(new Error('no wasm')) }

const garden = [
  '# Garden',
  '',
  'Moss grows best in shade with steady moisture. Water the moss gently in the morning.',
  '',
  '# Kitchen',
  '',
  'Sourdough bread needs a lively starter and a long, cool rise overnight.',
  '',
  '# Garage',
  '',
  'The bicycle chain needs oil every few hundred kilometres.',
].join('\n')

async function addDoc(id: string, text: string, name = `${id}.md`, embedder: Embedder = fakeEmbedder) {
  forgetCachedChunks(id)
  return indexFile(new File([text], name, { type: 'text/markdown' }), { id, embedder })
}

afterEach(() => setEmbedder(null))

test('falls back to keywords when the query cannot be embedded', async () => {
  await addDoc('garden-kw', garden)
  const hits = await retrieve('sourdough starter', ['garden-kw'], { embedder: broken })
  assert.equal(hits[0]!.method, 'keyword')
  assert.equal(hits[0]!.chunk.locator, 'Kitchen')
  assert.equal(hits.length, 1, 'only chunks containing a query term')
})

test('a slow model gives way to keywords after the timeout', async () => {
  await addDoc('slow', garden)
  const slow: Embedder = { id: fakeEmbedder.id, threshold: 0.1, embed: () => new Promise(() => {}) }
  const hits = await retrieve('sourdough', ['slow'], { embedder: slow, timeoutMs: 20 })
  assert.equal(hits[0]?.method, 'keyword')
})

test('the DOCUMENTS section and citations share numbering', async () => {
  await addDoc('pair', garden, 'Home notes.md')
  const hits = await retrieve('moss shade water', ['pair'], { embedder: fakeEmbedder, k: 2 })
  const prompt = documentsPrompt(hits)
  assert.match(prompt, /^DOCUMENTS\n/)
  assert.match(prompt, /cite each excerpt/)
  assert.match(prompt, /\[1\] Home notes\.md — Garden\n"""\n# Garden/)
  const citations = documentCitations(hits)
  assert.deepEqual(citations[0], {
    id: '1',
    kind: 'document',
    title: 'Home notes.md',
    documentId: 'pair',
    snippet: hits[0]!.chunk.text,
    locator: 'Garden',
  })
  assert.deepEqual(citations.map((citation) => citation.id), hits.map((_, index) => String(index + 1)))
})
