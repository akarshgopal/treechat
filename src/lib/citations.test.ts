import assert from 'node:assert/strict'
import test from 'node:test'
import { clearRunCitations, parseCitations, recordRunCitations, sameCitations, takeRunCitations } from './citations.ts'
import { fromUIMessages, sameTranscript, toUIMessages } from './messages.ts'
import type { ChatMessage, Citation } from '../types.ts'

const web: Citation = { id: '1', kind: 'web', title: 'Zhipu GLM', url: 'https://example.com/glm', snippet: 'GLM-4.6 released' }
const doc: Citation = { id: '2', kind: 'document', title: 'notes.pdf', documentId: 'doc-1', locator: 'p. 4' }

test('parseCitations keeps well-formed entries and drops the rest', () => {
  assert.deepEqual(parseCitations([web, doc]), [web, doc])
  assert.deepEqual(parseCitations([web, { id: '1', kind: 'web', title: 'dup' }]), [web])
  assert.equal(parseCitations([{ id: '3', kind: 'video', title: 'x' }, { kind: 'web', title: 'no id' }]), undefined)
  assert.equal(parseCitations('nope'), undefined)
})

test('citations survive the chat-engine round trip and count as a transcript change', () => {
  const message: ChatMessage = { id: 'a1', role: 'assistant', content: 'See [1] and [2].', createdAt: 1, citations: [web, doc] }
  const [back] = fromUIMessages(toUIMessages([message]))
  assert.deepEqual(back?.citations, [web, doc])
  assert.equal(sameTranscript([message], [{ ...message, citations: [web] }]), false)
  assert.equal(sameCitations(undefined, []), true)
})

test('run citations accumulate per thread and are taken once', () => {
  recordRunCitations('t1', [web])
  recordRunCitations('t1', [doc, { ...web, title: 'Updated' }])
  recordRunCitations('t2', [doc])
  assert.deepEqual(takeRunCitations('t1')?.map((c) => [c.id, c.title]), [['1', 'Updated'], ['2', 'notes.pdf']])
  assert.equal(takeRunCitations('t1'), undefined)
  clearRunCitations('t2')
  assert.equal(takeRunCitations('t2'), undefined)
})
