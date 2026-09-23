import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { collectAssistantText, openRouterChatStream } from './client-chat.ts'
import { clearRunCitations, takeRunCitations } from './citations.ts'
import { WEB_SEARCH_MAX_RESULTS, applyWebSearch, createWebCitationCollector, webSourcesFromChunk } from './web-search.ts'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

const config = { provider: 'openrouter' as const, apiKey: 'test-only', model: 'test-model' }

const annotation = (url: string, title: string, content?: string) => ({
  type: 'url_citation',
  url_citation: { url, title, ...(content ? { content } : {}), start_index: 0, end_index: 10 },
})

const sse = (...events: unknown[]) =>
  [...events.map((event) => `data: ${JSON.stringify(event)}\n\n`), 'data: [DONE]\n\n'].join('')

/** Stream `body` through the live transport; return the request body and recorded citations. */
async function run(body: string, forwardedProps: Record<string, unknown> = { webSearch: true }) {
  let request: Record<string, unknown> = {}
  globalThis.fetch = (async (_input, init) => {
    request = JSON.parse(String(init?.body))
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }) as typeof fetch
  clearRunCitations('web-thread')
  const text = await collectAssistantText(openRouterChatStream({
    messages: [{ role: 'user', content: 'Source?' }],
    config,
    forwardedProps,
    threadId: 'web-thread',
    runId: 'r1',
  }))
  return { text, request, citations: takeRunCitations('web-thread') }
}

test('the web plugin is requested only for web-search threads', async () => {
  const plain = await run(sse({ choices: [{ delta: { content: 'Hi' } }] }), { quote: 'a passage' })
  assert.equal('plugins' in plain.request, false)
  assert.equal(plain.citations, undefined)

  const searched = await run(sse({ choices: [{ delta: { content: 'Hi' } }] }), { webSearch: true, quote: 'a passage' })
  const plugins = searched.request.plugins as Array<Record<string, unknown>>
  assert.equal(plugins.length, 1)
  assert.equal(plugins[0]!.id, 'web')
  assert.equal(plugins[0]!.max_results, WEB_SEARCH_MAX_RESULTS)
  assert.match(String(plugins[0]!.search_prompt), /\[1\]/)
  assert.match(String(plugins[0]!.search_prompt), /a passage/)
  assert.equal(applyWebSearch({ model: 'm' }, { webSearch: false }).model, 'm')
  assert.equal('plugins' in applyWebSearch({ model: 'm' }, {}), false)
})

test('annotations on streamed deltas become numbered web citations', async () => {
  const { text, citations } = await run(sse(
    { choices: [{ delta: { content: 'Glaciers retreat [1]' } }] },
    { choices: [{ delta: { content: ' and seas rise [2].', annotations: [
      annotation('https://example.com/ice', 'Ice report', '  Glaciers   retreated\n by 5% ' ),
      annotation('https://example.org/sea', 'Sea levels'),
    ] } }] },
  ))
  assert.equal(text, 'Glaciers retreat [1] and seas rise [2].')
  assert.deepEqual(citations, [
    { id: '1', kind: 'web', url: 'https://example.com/ice', title: 'Ice report', snippet: 'Glaciers retreated by 5%' },
    { id: '2', kind: 'web', url: 'https://example.org/sea', title: 'Sea levels' },
  ])
})

test('annotations on a final message are read too, deduplicated by URL in first-seen order', async () => {
  const { citations } = await run(sse(
    { choices: [{ delta: { content: 'One [1], two [2].', annotations: [annotation('https://b.example.com/', 'B')] } }] },
    { choices: [{ delta: {}, message: { role: 'assistant', annotations: [
      annotation('https://a.example.com/x', 'A', 'a text'),
      annotation('https://b.example.com/', 'B again', 'b text'),
      annotation('https://a.example.com/x', 'A dup'),
      { type: 'url_citation', url_citation: { url: 'javascript:alert(1)', title: 'bad' } },
      { type: 'file', file: {} },
    ] }, finish_reason: 'stop' }] },
  ))
  assert.deepEqual(citations?.map((citation) => [citation.id, citation.url, citation.title, citation.snippet]), [
    ['1', 'https://b.example.com/', 'B', 'b text'],
    ['2', 'https://a.example.com/x', 'A', 'a text'],
  ])
})

test('a reply without annotations records no citations and keeps its text as written', async () => {
  const { text, citations } = await run(sse({ choices: [{ delta: { content: 'See [example.com](https://example.com).' } }] }))
  assert.equal(text, 'See [example.com](https://example.com).')
  assert.equal(citations, undefined)
})

test('sources are clipped, titled, and tolerate odd shapes', () => {
  assert.deepEqual(webSourcesFromChunk(null), [])
  assert.deepEqual(webSourcesFromChunk({ choices: 'no' }), [])
  const [flat] = webSourcesFromChunk({ choices: [{ delta: { annotations: [{ type: 'url_citation', url: 'https://www.example.com/p', content: 'word '.repeat(200) }] } }] })
  assert.equal(flat!.title, 'example.com')
  assert.ok(flat!.snippet!.length <= 280)
  assert.ok(!flat!.snippet!.endsWith(' '))
  const collector = createWebCitationCollector()
  assert.equal(collector.add({ choices: [{ delta: {} }] }), false)
  assert.equal(collector.add({ choices: [{ delta: { annotations: [annotation('https://x.example/', 'X')] } }] }), true)
  assert.equal(collector.add({ choices: [{ delta: { annotations: [annotation('https://x.example/', 'X', 'late text')] } }] }), true)
  assert.equal(collector.citations()[0]!.snippet, 'late text')
})
