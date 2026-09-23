import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { SourceUnavailableError, documentLoader, loadSourceContent } from '../source-content.ts'
import { saveIndexedDocument } from './store.ts'
import type { Citation } from '../../types.ts'

const citation = (documentId?: string): Citation => ({ id: '1', kind: 'document', title: 'notes.md', documentId, snippet: 'second part' })

test('a document citation opens the stored document text', async () => {
  await saveIndexedDocument(
    { id: 'lane', name: 'notes.md', format: 'markdown', size: 20, createdAt: 1, status: 'ready', chunkCount: 2 },
    [
      { id: 'lane:0', documentId: 'lane', index: 0, text: '# Notes\n\nfirst part' },
      { id: 'lane:1', documentId: 'lane', index: 1, text: 'second part' },
    ],
  )
  const content = await loadSourceContent(citation('lane'), new AbortController().signal)
  assert.match(content.markdown ?? '', /first part[\s\S]*second part/)
})

test('a removed or unknown document is unavailable, so the lane shows its fallback', async () => {
  await assert.rejects(documentLoader(citation('missing'), new AbortController().signal), SourceUnavailableError)
  await assert.rejects(documentLoader(citation(), new AbortController().signal), SourceUnavailableError)
})
