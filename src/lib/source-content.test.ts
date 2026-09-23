import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  READER_ORIGIN,
  SourceUnavailableError,
  loadSourceContent,
  locateSnippet,
  registerSourceLoader,
  stripReaderPreamble,
} from './source-content.ts'
import type { Citation } from '../types.ts'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

const web: Citation = { id: '1', kind: 'web', title: 'Page', url: 'https://example.com/a', snippet: 'the cited words' }
const doc: Citation = { id: '2', kind: 'document', title: 'notes.pdf', documentId: 'd1', locator: 'p. 4', snippet: 'from the notes' }
const signal = () => new AbortController().signal

test('a registered loader wins until it is unregistered', async () => {
  const seen: Citation[] = []
  const unregister = registerSourceLoader('document', async (citation) => {
    seen.push(citation)
    return { markdown: '# Notes\n\nfrom the notes, in full' }
  })
  assert.deepEqual(await loadSourceContent(doc, signal()), { markdown: '# Notes\n\nfrom the notes, in full' })
  assert.equal(seen[0], doc)
  unregister()
  // Back to the built-in document loader; this document is not stored here.
  await assert.rejects(loadSourceContent(doc, signal()), SourceUnavailableError)

  const empty = registerSourceLoader('document', async () => ({ markdown: '  ' }))
  await assert.rejects(loadSourceContent(doc, signal()), SourceUnavailableError)
  empty()
})

test('web pages load through the reader, and failures reject so the lane can fall back', async () => {
  const urls: string[] = []
  globalThis.fetch = (async (input) => {
    urls.push(String(input))
    return new Response('Title: Page\nURL Source: https://example.com/a\n\nMarkdown Content:\n# Page\n\nHere are the cited words.')
  }) as typeof fetch
  assert.deepEqual(await loadSourceContent(web, signal()), { markdown: '# Page\n\nHere are the cited words.' })
  assert.deepEqual(urls, [`${READER_ORIGIN}https://example.com/a`])

  globalThis.fetch = (async () => new Response('blocked', { status: 451 })) as typeof fetch
  await assert.rejects(loadSourceContent(web, signal()), SourceUnavailableError)
  globalThis.fetch = (async () => { throw new TypeError('Failed to fetch') }) as typeof fetch
  await assert.rejects(loadSourceContent(web, signal()), TypeError)
  // Never hand a non-web address to the reader.
  urls.length = 0
  globalThis.fetch = (async (input) => { urls.push(String(input)); return new Response('x') }) as typeof fetch
  await assert.rejects(loadSourceContent({ ...web, url: 'javascript:alert(1)' }, signal()), SourceUnavailableError)
  assert.deepEqual(urls, [])
})

test('the reader preamble is stripped when present', () => {
  assert.equal(stripReaderPreamble('# Plain\n'), '# Plain')
})

test('snippets are found despite case, whitespace and typographic quotes', () => {
  const text = 'Intro.  The Cited\n  words — “quoted” here.'
  const found = locateSnippet(text, 'the cited words - "quoted"')
  assert.ok(found)
  assert.equal(text.slice(found.start, found.end), 'The Cited\n  words — “quoted”')
  assert.equal(locateSnippet(text, 'absent'), null)
  assert.equal(locateSnippet(text, undefined), null)
  // A long quote that drifts from the page still lands on its opening words.
  const long = locateSnippet('one two three four five six seven eight nine ten', 'one two three four five six seven eight NOT HERE')
  assert.deepEqual(long, { start: 0, end: 'one two three four five six seven eight'.length })
})
