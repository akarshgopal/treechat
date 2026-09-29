import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { type Embedder } from './embedder.ts'
import { indexFile } from './ingest.ts'
import { getChunks } from './store.ts'

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
