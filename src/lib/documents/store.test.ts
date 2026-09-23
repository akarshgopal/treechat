import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { fakeEmbedder, type Embedder } from './embedder.ts'
import { indexFile } from './ingest.ts'
import {
  deleteDocument,
  getChunk,
  getChunks,
  getDocument,
  getDocumentText,
  listDocuments,
  putDocument,
  saveIndexedDocument,
} from './store.ts'
import { chunkId, type StoredDocument } from './types.ts'

const baseDoc = (id: string, createdAt = 1): StoredDocument => ({
  id, name: `${id}.md`, format: 'markdown', size: 10, createdAt, status: 'ready', chunkCount: 2,
})

test('documents and chunks round-trip, vectors stay Float32Array', async () => {
  const doc = baseDoc('rt')
  await saveIndexedDocument(doc, [
    { id: chunkId('rt', 1), documentId: 'rt', index: 1, text: 'second', locator: 'Two', heading: 'Two' },
    { id: chunkId('rt', 0), documentId: 'rt', index: 0, text: 'first', vector: new Float32Array([0.6, 0.8]) },
  ])
  assert.deepEqual(await getDocument('rt'), doc)
  const chunks = await getChunks('rt')
  assert.deepEqual(chunks.map((chunk) => chunk.text), ['first', 'second'])
  assert.ok(chunks[0]!.vector instanceof Float32Array)
  assert.deepEqual([...chunks[0]!.vector!], [0.6000000238418579, 0.800000011920929])
  assert.equal((await getChunk('rt:1'))?.locator, 'Two')
  assert.equal(await getChunk('rt:9'), undefined)
})

test('saving again replaces the old chunks', async () => {
  await saveIndexedDocument(baseDoc('re'), [
    { id: 're:0', documentId: 're', index: 0, text: 'a' },
    { id: 're:1', documentId: 're', index: 1, text: 'b' },
  ])
  await saveIndexedDocument({ ...baseDoc('re'), chunkCount: 1 }, [{ id: 're:0', documentId: 're', index: 0, text: 'fresh' }])
  assert.deepEqual((await getChunks('re')).map((chunk) => chunk.text), ['fresh'])
})

test('listDocuments is oldest first; deleting removes the chunks too', async () => {
  await putDocument(baseDoc('later', 30))
  await putDocument(baseDoc('earlier', 20))
  await saveIndexedDocument(baseDoc('gone', 25), [{ id: 'gone:0', documentId: 'gone', index: 0, text: 'x' }])
  const ids = (await listDocuments()).map((doc) => doc.id).filter((id) => ['later', 'earlier', 'gone'].includes(id))
  assert.deepEqual(ids, ['earlier', 'gone', 'later'])
  await deleteDocument('gone')
  assert.equal(await getDocument('gone'), undefined)
  assert.deepEqual(await getChunks('gone'), [])
})

test('getDocumentText rebuilds the text without chunk overlap', async () => {
  await saveIndexedDocument(baseDoc('txt'), [
    { id: 'txt:0', documentId: 'txt', index: 0, text: 'Alpha sentence here. Beta sentence follows along.' },
    { id: 'txt:1', documentId: 'txt', index: 1, text: 'Beta sentence follows along. Gamma closes it.' },
  ])
  assert.equal(await getDocumentText('txt'), 'Alpha sentence here. Beta sentence follows along.\n\nGamma closes it.')
})

test('indexFile stores a markdown file with vectors and headings', async () => {
  const file = new File(['# Garden\n\nMoss grows in shade.\n\n# Kitchen\n\nBread needs time to rise.'], 'notes.md', { type: 'text/markdown' })
  const stages: string[] = []
  const doc = await indexFile(file, { id: 'idx', embedder: fakeEmbedder, onProgress: (progress) => stages.push(progress.stage) })
  assert.equal(doc.status, 'ready')
  assert.equal(doc.embedderId, fakeEmbedder.id)
  assert.equal(doc.error, undefined)
  const chunks = await getChunks('idx')
  assert.equal(doc.chunkCount, chunks.length)
  assert.ok(chunks.every((chunk) => chunk.vector instanceof Float32Array))
  assert.deepEqual(chunks.map((chunk) => chunk.locator), ['Garden', 'Kitchen'])
  assert.deepEqual([...new Set(stages)], ['reading', 'embedding'])
})

test('indexFile keeps the document for keyword search when the model fails', async () => {
  const broken: Embedder = { id: 'broken', threshold: 0.2, embed: () => Promise.reject(new Error('offline')) }
  const doc = await indexFile(new File(['Some words to find later.'], 'a.txt', { type: 'text/plain' }), { id: 'kw', embedder: broken })
  assert.equal(doc.status, 'ready')
  assert.equal(doc.embedderId, undefined)
  assert.match(doc.error!, /Keyword search only.*offline/)
  const chunks = await getChunks('kw')
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0]!.vector, undefined)
})

test('indexFile marks an empty file as an error', async () => {
  const doc = await indexFile(new File(['  '], 'empty.txt', { type: 'text/plain' }), { id: 'empty', embedder: fakeEmbedder })
  assert.equal(doc.status, 'error')
  assert.match(doc.error!, /empty/)
  assert.equal((await getDocument('empty'))?.status, 'error')
})
