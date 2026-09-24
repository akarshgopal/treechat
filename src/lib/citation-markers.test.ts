import assert from 'node:assert/strict'
import test from 'node:test'
import {
  citationWhere,
  safeHttpUrl,
  sourceHost,
} from './citation-markers.ts'
import type { Citation } from '../types.ts'

const web: Citation = { id: '1', kind: 'web', title: 'Page', url: 'https://www.example.com/a', snippet: 'x' }
const doc: Citation = { id: '2', kind: 'document', title: 'notes.pdf', documentId: 'd1', locator: 'p. 4' }

test('source links are http(s) only and named by host or locator', () => {
  assert.equal(safeHttpUrl('javascript:alert(1)'), undefined)
  assert.equal(safeHttpUrl('not a url'), undefined)
  assert.equal(safeHttpUrl('https://example.com/a'), 'https://example.com/a')
  assert.equal(sourceHost(web.url), 'example.com')
  assert.equal(citationWhere(web), 'example.com')
  assert.equal(citationWhere({ ...web, locator: '§2' }), 'example.com · §2')
  assert.equal(citationWhere(doc), 'p. 4')
})
