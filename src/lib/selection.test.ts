import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_BRANCH_SELECTION,
  offsetsInRoot,
  selectableMessageFromRange,
  splitMarkedText,
  type Mark,
} from './selection.ts'

function mark(id: string, start: number, end: number, open = false): Mark {
  return { id, start, end, open }
}

test('splitMarkedText with no marks returns the whole string', () => {
  assert.deepEqual(splitMarkedText('hello', []), [{ text: 'hello' }])
})

test('splitMarkedText splits around a single mark', () => {
  const segments = splitMarkedText('one two three', [mark('a', 4, 7)])
  assert.deepEqual(segments, [
    { text: 'one ' },
    { text: 'two', marks: [mark('a', 4, 7)] },
    { text: ' three' },
  ])
})

test('splitMarkedText groups identical spans', () => {
  const segments = splitMarkedText('one two three', [
    mark('a', 4, 7),
    mark('b', 4, 7),
  ])
  assert.deepEqual(segments, [
    { text: 'one ' },
    { text: 'two', marks: [mark('a', 4, 7), mark('b', 4, 7)] },
    { text: ' three' },
  ])
})

test('splitMarkedText drops marks that fall outside the string', () => {
  assert.deepEqual(splitMarkedText('short', [mark('a', 2, 99)]), [
    { text: 'short' },
  ])
})

test('MAX_BRANCH_SELECTION is a generous sanity cap', () => {
  assert.ok(MAX_BRANCH_SELECTION >= 4_000)
})

let JSDOM: typeof import('jsdom').JSDOM | undefined
try {
  ;({ JSDOM } = await import('jsdom'))
} catch {
  JSDOM = undefined
}

function documentFor(html: string) {
  if (!JSDOM) throw new Error('jsdom unavailable')
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
    .document
}

function firstText(root: Node): Text {
  const doc = root.ownerDocument
  if (!doc) throw new Error('no document')
  const walker = doc.createTreeWalker(root, 4)
  const node = walker.nextNode()
  if (!node || node.nodeType !== 3) throw new Error('no text node')
  return node as Text
}

function lastText(root: Node): Text {
  const doc = root.ownerDocument
  if (!doc) throw new Error('no document')
  const walker = doc.createTreeWalker(root, 4)
  let node: Node | null = null
  let current: Node | null
  while ((current = walker.nextNode())) node = current
  if (!node || node.nodeType !== 3) throw new Error('no text node')
  return node as Text
}

function setRange(
  doc: Document,
  startNode: Node,
  startOffset: number,
  endNode: Node,
  endOffset: number,
) {
  const range = doc.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range
}

function domTest(name: string, fn: () => void) {
  test(name, (t) => {
    if (!JSDOM) {
      t.skip('jsdom/undici unavailable in this Node runtime')
      return
    }
    fn()
  })
}

domTest('offsetsInRoot maps a simple text selection', () => {
  const doc = documentFor(
    '<div data-message-id="m1" data-selectable="true">hello world</div>',
  )
  const root = doc.body.firstElementChild as HTMLElement
  const text = firstText(root)
  const range = setRange(doc, text, 0, text, 5)
  const offsets = offsetsInRoot(root, range)
  assert.deepEqual(offsets, { start: 0, end: 5, text: 'hello' })
})

domTest('offsetsInRoot handles multi-block paragraph selections', () => {
  const doc = documentFor(
    '<div data-message-id="m1" data-selectable="true"><p>alpha</p><p>beta gamma</p></div>',
  )
  const root = doc.body.firstElementChild as HTMLElement
  const start = firstText(root)
  const end = lastText(root)
  const range = setRange(doc, start, 0, end, end.data.length)
  const offsets = offsetsInRoot(root, range)
  assert.ok(offsets)
  assert.equal(offsets!.text.replace(/\s+/g, ' ').trim(), 'alpha beta gamma')
})

domTest('selectableMessageFromRange returns the owning message', () => {
  const doc = documentFor(
    '<div data-message-id="m1" data-selectable="true">hello world</div>',
  )
  const root = doc.body.firstElementChild as HTMLElement
  const text = firstText(root)
  const range = setRange(doc, text, 1, text, 4)
  assert.equal(selectableMessageFromRange(range), root)
})

domTest('selectableMessageFromRange is null across two messages', () => {
  const doc = documentFor(
    '<div data-message-id="m1" data-selectable="true">one</div>' +
      '<div data-message-id="m2" data-selectable="true">two</div>',
  )
  const a = doc.body.children[0] as HTMLElement
  const b = doc.body.children[1] as HTMLElement
  const range = setRange(doc, firstText(a), 0, firstText(b), 3)
  assert.equal(selectableMessageFromRange(range), null)
})
