import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import {
  MAX_BRANCH_SELECTION,
  offsetsInRoot,
  selectableMessageFromRange,
  splitMarkedText,
  type Mark,
} from './selection.ts'

function documentFor(html: string) {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document
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

const mark = (id: string, start: number, end: number, open = false): Mark => ({
  id,
  start,
  end,
  open,
})

test('plain text when there are no marks', () => {
  assert.deepEqual(splitMarkedText('hello', []), [{ text: 'hello' }])
})

test('splits around a single mark', () => {
  const segments = splitMarkedText('one two three', [mark('a', 4, 7)])
  assert.deepEqual(
    segments.map((s) => s.text),
    ['one ', 'two', ' three'],
  )
  assert.deepEqual(segments[1].marks?.map((m) => m.id), ['a'])
})

test('groups every branch hanging off the exact same span', () => {
  const segments = splitMarkedText('one two three', [
    mark('a', 4, 7),
    mark('b', 4, 7),
    mark('c', 4, 7),
  ])
  assert.equal(segments.length, 3)
  assert.deepEqual(segments[1].marks?.map((m) => m.id), ['a', 'b', 'c'])
})

test('keeps non-overlapping marks separate', () => {
  const segments = splitMarkedText('one two three', [
    mark('a', 0, 3),
    mark('b', 8, 13),
  ])
  assert.deepEqual(
    segments.filter((s) => s.marks).map((s) => s.marks![0].id),
    ['a', 'b'],
  )
})

test('a merely-overlapping mark loses to the first one', () => {
  const segments = splitMarkedText('one two three', [
    mark('a', 0, 7),
    mark('b', 4, 13),
  ])
  assert.deepEqual(
    segments.filter((s) => s.marks).map((s) => s.marks!.map((m) => m.id)),
    [['a']],
  )
})

test('drops marks that fall outside the content', () => {
  assert.deepEqual(splitMarkedText('short', [mark('a', 2, 99)]), [
    { text: 'short' },
  ])
})

test('offsetsInRoot maps a single word in one text node', () => {
  const doc = documentFor(
    '<div data-message-id="m1" data-selectable="true">one two three</div>',
  )
  const root = doc.querySelector<HTMLElement>('[data-message-id]')!
  const text = firstText(root)
  const range = setRange(doc, text, 4, text, 7)
  assert.deepEqual(offsetsInRoot(root, range), { start: 4, end: 7, text: 'two' })
})

test('offsetsInRoot maps a full sentence in one text node', () => {
  const sentence = 'Highlight any passage and grow a side-thread from it.'
  const doc = documentFor(
    `<div data-message-id="m1" data-selectable="true">${sentence}</div>`,
  )
  const root = doc.querySelector<HTMLElement>('[data-message-id]')!
  const text = firstText(root)
  const range = setRange(doc, text, 0, text, sentence.length)
  assert.deepEqual(offsetsInRoot(root, range), {
    start: 0,
    end: sentence.length,
    text: sentence,
  })
})

test('offsetsInRoot maps a multi-line paragraph in one text node', () => {
  const content = 'First line of the paragraph.\n\nSecond line still in the same message.'
  const doc = documentFor('<div data-message-id="m1" data-selectable="true"></div>')
  const root = doc.querySelector<HTMLElement>('[data-message-id]')!
  root.textContent = content
  const text = firstText(root)
  const range = setRange(doc, text, 0, text, content.length)
  assert.deepEqual(offsetsInRoot(root, range), {
    start: 0,
    end: content.length,
    text: content,
  })
})

test('offsetsInRoot maps a selection that spans two paragraph blocks', () => {
  const doc = documentFor(
    '<div data-message-id="m1" data-selectable="true"><p>First paragraph here.</p><p>Second paragraph here.</p></div>',
  )
  const root = doc.querySelector<HTMLElement>('[data-message-id]')!
  const start = firstText(root)
  const end = lastText(root)
  const range = setRange(doc, start, 0, end, end.data.length)
  const offsets = offsetsInRoot(root, range)
  assert.equal(offsets?.start, 0)
  assert.equal(offsets?.end, root.textContent?.length)
  assert.equal(offsets?.text, 'First paragraph here.Second paragraph here.')
})

test('offsetsInRoot maps a selection that spans list items', () => {
  const doc = documentFor(
    '<div data-message-id="m1" data-selectable="true"><ul><li>alpha item</li><li>bravo item</li></ul></div>',
  )
  const root = doc.querySelector<HTMLElement>('[data-message-id]')!
  const start = firstText(root)
  const end = lastText(root)
  const range = setRange(doc, start, 0, end, end.data.length)
  const offsets = offsetsInRoot(root, range)
  assert.equal(offsets?.start, 0)
  assert.equal(offsets?.text, 'alpha itembravo item')
  assert.equal(offsets?.end, offsets.text.length)
})

test('offsetsInRoot maps a range that crosses inline mark spans', () => {
  const doc = documentFor(
    '<div data-message-id="m1" data-selectable="true"><span>Hello </span><mark>world</mark><span> today</span></div>',
  )
  const root = doc.querySelector<HTMLElement>('[data-message-id]')!
  const start = firstText(root)
  const end = lastText(root)
  const range = setRange(doc, start, 0, end, end.data.length)
  assert.deepEqual(offsetsInRoot(root, range), {
    start: 0,
    end: 17,
    text: 'Hello world today',
  })
})

test('offsetsInRoot accepts a range parked on the message element boundary', () => {
  const doc = documentFor(
    '<div id="wrap"><div data-message-id="a" data-selectable="true">The whole paragraph.</div><div data-message-id="b" data-selectable="true">Next message.</div></div>',
  )
  const wrap = doc.getElementById('wrap')!
  const message = wrap.querySelector<HTMLElement>('[data-message-id="a"]')!
  const range = setRange(doc, wrap, 0, wrap, 1)
  assert.equal(selectableMessageFromRange(range)?.dataset.messageId, 'a')
  assert.deepEqual(offsetsInRoot(message, range), {
    start: 0,
    end: 20,
    text: 'The whole paragraph.',
  })
})

test('offsetsInRoot accepts a range that ends at the start of the next message', () => {
  const doc = documentFor(
    '<div id="wrap"><div data-message-id="a" data-selectable="true">The whole paragraph.</div><div data-message-id="b" data-selectable="true">Next message.</div></div>',
  )
  const wrap = doc.getElementById('wrap')!
  const first = wrap.querySelector<HTMLElement>('[data-message-id="a"]')!
  const second = wrap.querySelector<HTMLElement>('[data-message-id="b"]')!
  const range = setRange(doc, firstText(first), 0, second, 0)
  assert.equal(selectableMessageFromRange(range)?.dataset.messageId, 'a')
  assert.equal(offsetsInRoot(first, range)?.text, 'The whole paragraph.')
})

test('offsetsInRoot hides a selection that leaves the message', () => {
  const doc = documentFor(
    '<div id="wrap"><div data-message-id="a" data-selectable="true">Hello there.</div><div data-message-id="b" data-selectable="true">Other message.</div></div>',
  )
  const wrap = doc.getElementById('wrap')!
  const first = wrap.querySelector<HTMLElement>('[data-message-id="a"]')!
  const second = wrap.querySelector<HTMLElement>('[data-message-id="b"]')!
  const range = setRange(doc, firstText(first), 0, lastText(second), 5)
  assert.equal(selectableMessageFromRange(range), null)
  assert.equal(offsetsInRoot(first, range), null)
})

test('offsetsInRoot returns null for collapsed or whitespace selections', () => {
  const doc = documentFor(
    '<div data-message-id="m1" data-selectable="true">alpha   beta</div>',
  )
  const root = doc.querySelector<HTMLElement>('[data-message-id]')!
  const text = firstText(root)
  assert.equal(offsetsInRoot(root, setRange(doc, text, 2, text, 2)), null)
  assert.equal(offsetsInRoot(root, setRange(doc, text, 5, text, 8)), null)
})

test('offsetsInRoot rejects huge selections past the sanity cap', () => {
  const content = 'x'.repeat(MAX_BRANCH_SELECTION + 1)
  const doc = documentFor('<div data-message-id="m1" data-selectable="true"></div>')
  const root = doc.querySelector<HTMLElement>('[data-message-id]')!
  root.textContent = content
  const text = firstText(root)
  const range = setRange(doc, text, 0, text, content.length)
  assert.equal(offsetsInRoot(root, range), null)

  const allowed = 'y'.repeat(MAX_BRANCH_SELECTION)
  root.textContent = allowed
  const allowedText = firstText(root)
  const allowedRange = setRange(doc, allowedText, 0, allowedText, allowed.length)
  assert.equal(offsetsInRoot(root, allowedRange)?.end, MAX_BRANCH_SELECTION)
})
