import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { EventType, type StreamChunk } from '@tanstack/ai'
import { takeRunCitations } from '../citations.ts'
import { setEmbedder } from './active-embedder.ts'
import { fakeEmbedder, type Embedder } from './embedder.ts'
import { indexFile } from './ingest.ts'
import { withDocumentNote, withDocuments, retrievalQuery } from './rag.ts'
import { documentCitations, documentsPrompt, forgetCachedChunks, retrieve } from './retrieve.ts'
import { putDocument } from './store.ts'

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

test('ranks chunks by cosine with the fake embedder and keeps locators', async () => {
  await addDoc('garden', garden)
  const hits = await retrieve('how often should I water the moss in shade', ['garden'], { embedder: fakeEmbedder, k: 5 })
  assert.ok(hits.length >= 1)
  assert.equal(hits[0]!.chunk.locator, 'Garden')
  assert.equal(hits[0]!.method, 'vector')
  assert.ok(hits.every((hit, index) => index === 0 || hits[index - 1]!.score >= hit.score))
  // Unrelated sections fall under the threshold.
  assert.ok(!hits.some((hit) => hit.chunk.locator === 'Garage'))
})

test('k caps the number of excerpts', async () => {
  await addDoc('many', Array.from({ length: 12 }, (_, index) => `# Part ${index}\n\nshared topic words appear here ${index}`).join('\n\n'))
  const hits = await retrieve('shared topic words', ['many'], { embedder: fakeEmbedder, k: 3 })
  assert.equal(hits.length, 3)
})

test('falls back to keywords when the query cannot be embedded', async () => {
  await addDoc('garden-kw', garden)
  const hits = await retrieve('sourdough starter', ['garden-kw'], { embedder: broken })
  assert.equal(hits[0]!.method, 'keyword')
  assert.equal(hits[0]!.chunk.locator, 'Kitchen')
  assert.equal(hits.length, 1, 'only chunks containing a query term')
})

test('documents indexed without vectors are searched by keyword', async () => {
  const failing: Embedder = { id: 'other', threshold: 0.2, embed: () => Promise.reject(new Error('offline')) }
  await addDoc('novec', garden, 'novec.md', failing)
  const hits = await retrieve('bicycle chain oil', ['novec'], { embedder: fakeEmbedder })
  assert.equal(hits[0]!.method, 'keyword')
  assert.equal(hits[0]!.chunk.locator, 'Garage')
})

test('a slow model gives way to keywords after the timeout', async () => {
  await addDoc('slow', garden)
  const slow: Embedder = { id: fakeEmbedder.id, threshold: 0.1, embed: () => new Promise(() => {}) }
  const hits = await retrieve('sourdough', ['slow'], { embedder: slow, timeoutMs: 20 })
  assert.equal(hits[0]?.method, 'keyword')
})

test('missing, failed, and still-indexing documents are skipped', async () => {
  await putDocument({ id: 'busy', name: 'busy.md', format: 'markdown', size: 1, createdAt: 1, status: 'indexing', chunkCount: 0 })
  assert.deepEqual(await retrieve('anything', ['nope', 'busy'], { embedder: fakeEmbedder }), [])
  assert.deepEqual(await retrieve('   ', ['garden'], { embedder: fakeEmbedder }), [])
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

test('retrievalQuery joins the latest user message with a branch quote', () => {
  const messages = [
    { role: 'user', content: 'old question' },
    { role: 'assistant', content: 'answer' },
    { role: 'user', parts: [{ type: 'text', content: 'new question' }] },
  ]
  assert.equal(retrievalQuery(messages, {}), 'new question')
  assert.equal(retrievalQuery(messages, { quote: ' the passage ' }), 'new question\nthe passage')
})

test('withDocuments adds a documents section and records citations for the run', async () => {
  await addDoc('rag', garden, 'Garden.md')
  setEmbedder(fakeEmbedder)
  const result = await withDocuments({
    messages: [{ role: 'user', content: 'When should I water moss?' }],
    forwardedProps: { documentIds: ['rag'], cacheSessionId: 's1' },
    threadId: 'thread-rag',
  })
  assert.equal(result.forwardedProps.documentIds, undefined)
  assert.equal(result.forwardedProps.cacheSessionId, 's1')
  assert.match(String(result.forwardedProps.documents), /\[1\] Garden\.md — Garden/)
  assert.equal(result.citations[0]!.kind, 'document')
  assert.deepEqual(takeRunCitations('thread-rag'), result.citations)
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

test('withDocumentNote appends markers to demo replies before they end', async () => {
  async function* reply(): AsyncGenerator<StreamChunk> {
    yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm', delta: 'Demo.', timestamp: 0 }
    yield { type: EventType.TEXT_MESSAGE_END, messageId: 'm', timestamp: 0 }
  }
  const chunks: StreamChunk[] = []
  for await (const chunk of withDocumentNote(reply(), [{ id: '1', kind: 'document', title: 'Garden.md', locator: 'p. 2' }])) chunks.push(chunk)
  const text = chunks.map((chunk) => (chunk.type === EventType.TEXT_MESSAGE_CONTENT ? chunk.delta : '')).join('')
  assert.match(text, /^Demo\.\n\nMatching excerpts from your documents:\n- Garden\.md, p\. 2 \[1\]$/)
  assert.equal(chunks.at(-1)!.type, EventType.TEXT_MESSAGE_END)
})
