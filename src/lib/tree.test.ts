import assert from 'node:assert/strict'
import test from 'node:test'
import {
  branchForwardedProps,
  childThreadsForMessage,
  clipText,
  CONTEXT_MAIN,
  CONTEXT_QUOTE,
  contextBranchLabel,
  contextOmittedLabel,
  cycleOpenId,
  depthFrom,
  depthOf,
  descendantIds,
  expansionToReveal,
  groupThreadsBySpan,
  pathTo,
  subtreeSize,
  threadContext,
  transcriptUpTo,
} from './tree.ts'
import type { ChatMessage, Thread, TreeState } from '../types.ts'

const msg = (id: string, role: 'user' | 'assistant', content: string): ChatMessage => ({
  id,
  role,
  content,
  createdAt: 0,
})

const thread = (
  id: string,
  parentId: string | null,
  anchorMessageId: string | null,
  quote: string,
  messages: ChatMessage[],
  createdAt = 0,
): Thread => ({
  id,
  parentId,
  anchor: anchorMessageId
    ? { messageId: anchorMessageId, start: 0, end: quote.length, quote }
    : null,
  messages,
  createdAt,
  rev: 0,
})

// root ── b1 ── b1a
//      └─ b2
const root = thread('root', null, null, '', [
  msg('r1', 'user', 'why is /orders slow?'),
  msg('r2', 'assistant', 'stale stats, or a type mismatch in the predicate'),
  msg('r3', 'user', 'unrelated follow up'),
])
const b1 = thread('b1', 'root', 'r2', 'a type mismatch in the predicate', [
  msg('b1m1', 'user', 'how would I spot one?'),
  msg('b1m2', 'assistant', 'look for a cast on the column side'),
], 1)
const b1a = thread('b1a', 'b1', 'b1m2', 'a cast on the column side', [
  msg('b1am1', 'user', 'why does that break the index?'),
], 2)
const b2 = thread('b2', 'root', 'r2', 'stale stats', [], 3)

const state: TreeState = {
  threads: { root, b1, b1a, b2 },
  rootId: 'root',
  activeThreadId: 'root',
  expanded: {},
}

test('a branch of a branch resolves its full path', () => {
  assert.deepEqual(pathTo(state, 'b1a').map((t) => t.id), ['root', 'b1', 'b1a'])
  assert.equal(depthOf(state, 'b1a'), 2)
  assert.equal(depthOf(state, 'root'), 0)
  assert.equal(depthFrom(state, 'root', 'b1a'), 2)
  assert.equal(depthFrom(state, 'b1', 'b1a'), 1)
  assert.equal(depthFrom(state, 'b1a', 'b1a'), 0)
  assert.equal(depthFrom(state, 'b2', 'b1a'), Number.POSITIVE_INFINITY)
})

test('children are found per anchoring message', () => {
  assert.deepEqual(
    childThreadsForMessage(state, 'root', 'r2').map((t) => t.id),
    ['b1', 'b2'],
  )
  assert.deepEqual(childThreadsForMessage(state, 'root', 'r1'), [])
  assert.deepEqual(
    childThreadsForMessage(state, 'b1', 'b1m2').map((t) => t.id),
    ['b1a'],
  )
})

test('descendants and subtree size walk the whole branch', () => {
  assert.deepEqual(descendantIds(state, 'b1').sort(), ['b1', 'b1a'])
  assert.equal(subtreeSize(state, 'b1'), 3)
  assert.equal(subtreeSize(state, 'b2'), 0)
  assert.equal(subtreeSize(state, 'root'), 6)
})

test('transcript stops at the anchor message', () => {
  const out = transcriptUpTo(root.messages, 'r2')
  assert.match(out, /type mismatch in the predicate$/)
  assert.ok(!out.includes('unrelated follow up'))
})

test('the root thread has no upstream context', () => {
  assert.equal(threadContext(state, 'root'), '')
})

test('a first-level branch is MAIN then SELECTED QUOTE', () => {
  const out = threadContext(state, 'b1')
  assert.ok(out.startsWith(CONTEXT_MAIN))
  assert.ok(out.includes('why is /orders slow?'))
  assert.ok(out.includes('«a type mismatch in the predicate»'))
  assert.ok(!out.includes('unrelated follow up'))
  assert.ok(!out.includes(contextBranchLabel(1)))
  const quoteAt = out.lastIndexOf(CONTEXT_QUOTE)
  assert.ok(quoteAt > out.indexOf(CONTEXT_MAIN))
  assert.match(out.slice(quoteAt), /SELECTED QUOTE\n«a type mismatch in the predicate»/)
})

test('a nested branch is MAIN → BRANCH depth N → SELECTED QUOTE', () => {
  const out = threadContext(state, 'b1a')
  const mainAt = out.indexOf(CONTEXT_MAIN)
  const branchAt = out.indexOf(contextBranchLabel(1))
  const quoteAt = out.lastIndexOf(CONTEXT_QUOTE)
  assert.ok(mainAt === 0, 'starts with MAIN')
  assert.ok(branchAt > mainAt, 'root section precedes the branch section')
  assert.ok(quoteAt > branchAt, 'SELECTED QUOTE is last')
  assert.ok(out.includes('«a type mismatch in the predicate»'))
  assert.ok(out.includes('«a cast on the column side»'))
  assert.ok(out.includes('how would I spot one?'))
  assert.ok(!out.includes('---'))
  assert.ok(!out.includes('the user selected'))
})

test('an unknown thread yields an empty path rather than throwing', () => {
  assert.deepEqual(pathTo(state, 'nope'), [])
  assert.equal(threadContext(state, 'nope'), '')
})

test('nested context stays structured and does not include the leaf transcript', () => {
  const out = threadContext(state, 'b1a')
  assert.ok(!out.includes('why does that break the index?'))
  const lines = out.split('\n').filter(Boolean)
  assert.equal(lines[0], CONTEXT_MAIN)
  assert.ok(lines.includes(contextBranchLabel(1)))
  assert.ok(lines.includes(CONTEXT_QUOTE))
})

test('a deep ancestor chain keeps MAIN + nearest branches and omits the middle', () => {
  const deepMessages = (id: string, quote: string): ChatMessage[] => [
    msg(`${id}-u`, 'user', `ask ${id}`),
    msg(`${id}-a`, 'assistant', `answer mentioning ${quote}`),
  ]

  const threads: Record<string, Thread> = {
    root: thread('root', null, null, '', [
      msg('r1', 'user', 'root question'),
      msg('r2', 'assistant', 'root answer about alpha'),
    ]),
  }
  const quotes = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']
  let parentId = 'root'
  let parentAnchorMsg = 'r2'
  quotes.forEach((quote, index) => {
    const id = `d${index + 1}`
    const created = thread(
      id,
      parentId,
      parentAnchorMsg,
      quote,
      deepMessages(id, quotes[index + 1] ?? 'leaf'),
      index + 1,
    )
    threads[id] = created
    parentId = id
    parentAnchorMsg = `${id}-a`
  })

  const deep: TreeState = {
    threads,
    rootId: 'root',
    activeThreadId: 'd6',
    expanded: {},
  }

  const out = threadContext(deep, 'd6')
  assert.ok(out.startsWith(CONTEXT_MAIN), out)
  assert.ok(out.includes('root question'))
  assert.ok(out.includes(contextOmittedLabel(2)), out)
  assert.ok(!out.includes(contextBranchLabel(1)), out)
  assert.ok(!out.includes(contextBranchLabel(2)), out)
  assert.ok(out.includes(contextBranchLabel(3)), out)
  assert.ok(out.includes(contextBranchLabel(4)))
  assert.ok(out.includes(contextBranchLabel(5)))
  assert.ok(out.includes(CONTEXT_QUOTE))
  assert.ok(out.includes('«foxtrot»'))
  assert.ok(!out.includes('ask d6'), 'leaf transcript is not upstream context')
})

test('long quotes in context are clipped', () => {
  const long = 'x'.repeat(400)
  const local: TreeState = {
    threads: {
      root: thread('root', null, null, '', [
        msg('r1', 'assistant', `hello ${long}`),
      ]),
      b1: thread('b1', 'root', 'r1', long, [msg('b1m1', 'user', 'huh')], 1),
    },
    rootId: 'root',
    activeThreadId: 'b1',
    expanded: {},
  }
  const out = threadContext(local, 'b1')
  const quoteSection = out.slice(out.lastIndexOf(CONTEXT_QUOTE))
  assert.ok(quoteSection.includes('…'))
  assert.ok(!quoteSection.includes(long))
  assert.ok(clipText(long, 240).endsWith('…'))
  assert.ok(clipText(long, 240).length <= 240)
})

test('branchForwardedProps always sends quote and context together', () => {
  assert.equal(branchForwardedProps(state, 'root'), null)
  assert.equal(branchForwardedProps(state, 'nope'), null)

  const first = branchForwardedProps(state, 'b1')
  assert.ok(first)
  assert.equal(first.quote, 'a type mismatch in the predicate')
  assert.ok(first.context.includes(CONTEXT_MAIN))
  assert.ok(first.context.includes(CONTEXT_QUOTE))
  assert.ok(first.context.includes(first.quote))

  const nested = branchForwardedProps(state, 'b1a')
  assert.ok(nested)
  assert.equal(nested.quote, 'a cast on the column side')
  assert.ok(nested.context.includes(CONTEXT_MAIN))
  assert.ok(nested.context.includes(contextBranchLabel(1)))
  assert.ok(nested.context.includes(CONTEXT_QUOTE))
  assert.ok(nested.context.includes(nested.quote))
})

test('expansionToReveal opens every ancestor along the path', () => {
  assert.deepEqual(expansionToReveal(state, 'root'), {})
  assert.deepEqual(expansionToReveal(state, 'b1'), { root: 'b1' })
  assert.deepEqual(expansionToReveal(state, 'b1a'), { root: 'b1', b1: 'b1a' })
})

test('cycleOpenId walks a stable order then closes', () => {
  assert.equal(cycleOpenId([], null), null)
  assert.equal(cycleOpenId(['a', 'b', 'c'], null), 'a')
  assert.equal(cycleOpenId(['a', 'b', 'c'], 'a'), 'b')
  assert.equal(cycleOpenId(['a', 'b', 'c'], 'b'), 'c')
  assert.equal(cycleOpenId(['a', 'b', 'c'], 'c'), null)
  assert.equal(cycleOpenId(['a', 'b', 'c'], 'gone'), null)
})

test('groupThreadsBySpan keeps oldest-first groups', () => {
  const extra = thread('b3', 'root', 'r2', 'stale stats', [], 4)
  extra.anchor = { messageId: 'r2', start: 0, end: 'stale stats'.length, quote: 'stale stats' }
  const grouped = groupThreadsBySpan([b1, b2, extra])
  assert.deepEqual(
    grouped.map((group) => group.map((t) => t.id)),
    [['b1'], ['b2', extra.id]],
  )
})
