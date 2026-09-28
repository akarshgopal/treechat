import assert from 'node:assert/strict'
import test from 'node:test'
import { anchorLabel, anchorSourceKey, cropBox, isTextAnchor, regionFromDrag, surroundingText } from './anchors.ts'
import { exploredMatches } from './explored.ts'
import { createSeedState } from './seed.ts'
import { parseSession } from './storage.ts'
import { attachmentIds } from './transfer.ts'
import { branchForwardedProps } from './tree.ts'
import type { Anchor, ChatSession, Thread } from '../types.ts'

const text: Anchor = { messageId: 'm', start: 0, end: 4, quote: 'Clear' }
const fromPage: Anchor = {
  ...text,
  quote: 'ozone absorbs part of the orange and red light',
  source: { kind: 'document', title: 'atmosphere-notes.pdf', documentId: 'doc-1', locator: 'p. 3', context: 'Near twilight, ozone absorbs part of the orange and red light, which keeps the zenith blue.' },
}
const crop = { id: 'crop-1', kind: 'image' as const, name: 'Region of chart.png', mime: 'image/png', size: 10 }
const fromImage: Anchor = { ...text, start: 0, end: 0, quote: 'A region of chart.png', region: { attachmentId: 'img-1', name: 'chart.png', x: 0.1, y: 0.2, w: 0.3, h: 0.4, crop } }

test('what an anchor counts in, and how it is labelled', () => {
  assert.equal(anchorSourceKey(text), '')
  assert.equal(anchorSourceKey(fromPage), 'document:doc-1')
  assert.equal(anchorSourceKey({ source: { kind: 'web', title: 'T', url: 'https://example.com' } }), 'web:https://example.com')
  assert.equal(anchorSourceKey(fromImage), 'image:img-1')
  assert.ok(isTextAnchor(text) && !isTextAnchor(fromPage) && !isTextAnchor(fromImage))
  assert.equal(anchorLabel(fromPage), 'From atmosphere-notes.pdf')
  assert.equal(anchorLabel(fromImage), 'From chart.png')
  assert.equal(anchorLabel(text), null)
})

test('surrounding text is bounded and cut at word edges', () => {
  const source = `${'alpha '.repeat(200)}THE PASSAGE${' omega'.repeat(200)}`
  const start = source.indexOf('THE PASSAGE')
  const around = surroundingText(source, start, start + 11, 60)
  assert.ok(around.startsWith('…alpha') && around.endsWith('omega…'))
  assert.ok(around.includes('THE PASSAGE'))
  assert.ok(around.length < 150)
  assert.equal(surroundingText('short text', 0, 5), 'short text')
})

test('a drag becomes a rectangle in fractions, clamped to the image; a click is nothing', () => {
  const bounds = { left: 100, top: 50, width: 200, height: 100 }
  assert.deepEqual(regionFromDrag({ x: 150, y: 60 }, { x: 350, y: 100 }, bounds), { x: 0.25, y: 0.1, w: 0.75, h: 0.4 })
  assert.deepEqual(regionFromDrag({ x: 250, y: 140 }, { x: 110, y: 20 }, bounds), { x: 0.05, y: 0, w: 0.7, h: 0.9 })
  assert.equal(regionFromDrag({ x: 150, y: 60 }, { x: 152, y: 90 }, bounds), null)
  assert.deepEqual(cropBox({ x: 0.25, y: 0.1, w: 0.75, h: 0.4 }, 800, 400), { left: 200, top: 40, width: 600, height: 160 })
  assert.deepEqual(cropBox({ x: 1, y: 1, w: 0, h: 0 }, 10, 10), { left: 9, top: 9, width: 1, height: 1 })
})

function sessionWith(anchor: Anchor): ChatSession {
  const treeState = createSeedState()
  const branch: Thread = { id: 'b', parentId: 'thread-root', anchor: { ...anchor, messageId: 'msg-root-2' }, messages: [{ id: 'q', role: 'user', content: 'Why?', createdAt: 1 }, { id: 'a', role: 'assistant', content: 'Because.', createdAt: 2 }], createdAt: 1, rev: 0 }
  treeState.threads.b = branch
  return { id: 's', title: 'T', createdAt: 1, updatedAt: 1, titleLocked: true, treeState }
}

test('source and region anchors are saved and read back; broken ones become plain', () => {
  for (const anchor of [fromPage, fromImage]) {
    const parsed = parseSession(JSON.parse(JSON.stringify(sessionWith(anchor))))!
    assert.deepEqual(parsed.treeState.threads.b!.anchor, { ...anchor, messageId: 'msg-root-2' })
  }
  const broken = JSON.parse(JSON.stringify(sessionWith(fromImage)))
  broken.treeState.threads.b.anchor.region.w = 3
  broken.treeState.threads.b.anchor.source = { kind: 'ftp', title: 'x' }
  assert.deepEqual(parseSession(broken)!.treeState.threads.b!.anchor, { messageId: 'msg-root-2', start: 0, end: 0, quote: 'A region of chart.png' })
})

test('an export carries a region crop; the branch context names the source and quotes around it', () => {
  assert.ok(attachmentIds([sessionWith(fromImage)]).includes('crop-1'))
  const page = branchForwardedProps(sessionWith(fromPage).treeState, 'b')!
  assert.match(page.context, /SELECTED QUOTE \(from the document “atmosphere-notes\.pdf”, p\. 3\)\n«ozone absorbs part of the orange and red light»\nAround it in the source:\nNear twilight, ozone absorbs/)
  const image = branchForwardedProps(sessionWith(fromImage).treeState, 'b')!
  assert.match(image.context, /SELECTED QUOTE \(a region of the image chart\.png, attached\)/)
})

test('a passage matches branches anchored over it only within the same text', () => {
  const session = sessionWith({ ...fromPage, start: 10, end: 40 })
  const passage = { sessionId: 's', threadId: 'thread-root', messageId: 'msg-root-2', start: 20, end: 30 }
  assert.deepEqual(exploredMatches([session], { passage, sessionId: 's' }), [])
  assert.equal(exploredMatches([session], { passage: { ...passage, sourceKey: 'document:doc-1' }, sessionId: 's' })[0]?.threadId, 'b')
})

test('a document opened beside a thread (no anchor message) reads the thread so far', () => {
  const session = sessionWith({ ...fromPage, source: { ...fromPage.source!, citationId: undefined } })
  session.treeState.threads.b!.anchor!.messageId = ''
  const { context } = branchForwardedProps(session.treeState, 'b')!
  // The main thread's latest message is in, not just the quote.
  assert.match(context, /assistant: Every lane has its own composer/)
})
