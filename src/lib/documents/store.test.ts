import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { type Embedder } from './embedder.ts'
import { indexFile } from './ingest.ts'
import {
  getChunks,
  getDocumentText,
  saveIndexedDocument,
} from './store.ts'
import { type StoredDocument } from './types.ts'

const baseDoc = (id: string, createdAt = 1): StoredDocument => ({
  id, name: `${id}.md`, format: 'markdown', size: 10, createdAt, status: 'ready', chunkCount: 2,
})

test('getDocumentText rebuilds the text without chunk overlap', async () => {
  await saveIndexedDocument(baseDoc('txt'), [
    { id: 'txt:0', documentId: 'txt', index: 0, text: 'Alpha sentence here. Beta sentence follows along.' },
    { id: 'txt:1', documentId: 'txt', index: 1, text: 'Beta sentence follows along. Gamma closes it.' },
  ])
  assert.equal(await getDocumentText('txt'), 'Alpha sentence here. Beta sentence follows along.\n\nGamma closes it.')
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
