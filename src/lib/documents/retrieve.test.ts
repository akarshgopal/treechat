import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { takeRunCitations } from '../citations.ts'
import { setEmbedder } from './active-embedder.ts'
import { fakeEmbedder, type Embedder } from './embedder.ts'
import { indexFile } from './ingest.ts'
import { withDocuments } from './rag.ts'
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

test('withDocuments is a no-op without documents, and never throws', async () => {
  const none = await withDocuments({ messages: [], forwardedProps: { quote: 'q' }, threadId: 't' })
  assert.deepEqual(none, { forwardedProps: { quote: 'q' }, citations: [] })

  await addDoc('boom', garden)
  // An embedder that blows up outside the guarded embedding call.
  const exploding = { threshold: 0, embed: fakeEmbedder.embed, get id(): string { throw new Error('boom') } }
  const warnings: unknown[] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => { warnings.push(args) }
  try {
    const result = await withDocuments({
      messages: [{ role: 'user', content: 'moss' }],
      forwardedProps: { documentIds: ['boom'], quote: 'q' },
      threadId: 't2',
      embedder: exploding,
    })
    assert.deepEqual(result, { forwardedProps: { quote: 'q' }, citations: [] })
    assert.equal(warnings.length, 1)
    assert.equal(takeRunCitations('t2'), undefined)
  } finally {
    console.warn = originalWarn
  }
})
