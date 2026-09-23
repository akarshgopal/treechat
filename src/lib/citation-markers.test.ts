import assert from 'node:assert/strict'
import test from 'node:test'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import {
  citationWhere,
  citedIds,
  safeHttpUrl,
  sourceHost,
  splitCitationMarkers,
  wrapCitationMarkers,
} from './citation-markers.ts'
import { hastPlainText, wrapHastWithMarks, type HastElement, type HastRoot } from './markdown.ts'
import type { Citation } from '../types.ts'

const web: Citation = { id: '1', kind: 'web', title: 'Page', url: 'https://www.example.com/a', snippet: 'x' }
const doc: Citation = { id: '2', kind: 'document', title: 'notes.pdf', documentId: 'd1', locator: 'p. 4' }

function parse(markdown: string): HastRoot {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype)
  return processor.runSync(processor.parse(markdown)) as HastRoot
}

function elements(node: HastRoot | HastElement, tag: string): HastElement[] {
  const out: HastElement[] = []
  for (const child of node.children ?? []) {
    if (child.type !== 'element') continue
    const element = child as HastElement
    if (element.tagName === tag) out.push(element)
    out.push(...elements(element, tag))
  }
  return out
}

test('only markers for known citations split out', () => {
  const ids = new Set(['1', '2'])
  assert.deepEqual(splitCitationMarkers('A [1] and [2][1], not [3] or [sic].', ids), [
    { text: 'A ' },
    { text: '[1]', citationId: '1' },
    { text: ' and ' },
    { text: '[2]', citationId: '2' },
    { text: '[1]', citationId: '1' },
    { text: ', not [3] or [sic].' },
  ])
  assert.deepEqual(splitCitationMarkers('no markers', ids), [{ text: 'no markers' }])
  assert.deepEqual(citedIds('See [2], then [1] and [2] and [9].', [web, doc]), ['2', '1'])
  assert.deepEqual(citedIds('See [1].', undefined), [])
})

test('chips keep the visible text, so branch offsets are the same with or without them', () => {
  const markdown = 'Tangents stay put [1]. Takeaways **return** [2] and [7] stays text.\n\n`code [1]` and [link [1]](https://example.com)'
  const plain = hastPlainText(parse(markdown))
  const tree = parse(markdown)
  wrapCitationMarkers(tree, new Set(['1', '2']))
  assert.equal(hastPlainText(tree), plain)
  const chips = elements(tree, 'sup')
  assert.deepEqual(chips.map((chip) => chip.properties?.dataCitationId), ['1', '2'], 'code and links keep their markers as text')

  // A branch anchored across a chip still wraps exactly the anchored text.
  const start = plain.indexOf('stay put')
  const end = plain.indexOf('Takeaways') + 'Takeaways'.length
  wrapHastWithMarks(tree, [{ id: 'b1', start, end, open: false }])
  const marked = elements(tree, 'mark').map((mark) => hastPlainText(mark)).join('')
  assert.equal(marked, plain.slice(start, end))
  assert.equal(hastPlainText(tree), plain)
})

test('source links are http(s) only and named by host or locator', () => {
  assert.equal(safeHttpUrl('javascript:alert(1)'), undefined)
  assert.equal(safeHttpUrl('not a url'), undefined)
  assert.equal(safeHttpUrl('https://example.com/a'), 'https://example.com/a')
  assert.equal(sourceHost(web.url), 'example.com')
  assert.equal(citationWhere(web), 'example.com')
  assert.equal(citationWhere({ ...web, locator: '§2' }), 'example.com · §2')
  assert.equal(citationWhere(doc), 'p. 4')
})
