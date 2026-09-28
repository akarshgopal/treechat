import assert from 'node:assert/strict'
import test from 'node:test'
import { exploredMatches, significantTerms } from './explored.ts'
import type { ChatMessage, ChatSession, Thread } from '../types.ts'

const message = (id: string, role: ChatMessage['role'], content: string, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, role, content, createdAt: 0, ...extra })

const branch = (id: string, parentId: string, question: string, anchor: { messageId: string; start: number; end: number; quote: string }, createdAt = 1): Thread => ({
  id,
  parentId,
  anchor,
  messages: [message(`${id}-q`, 'user', question), message(`${id}-a`, 'assistant', 'An answer.')],
  createdAt,
  rev: 0,
})

function session(id: string, title: string, threads: Thread[]): ChatSession {
  const root: Thread = {
    id: `${id}-root`,
    parentId: null,
    anchor: null,
    messages: [message('m1', 'user', 'Why is the sky blue?'), message('m2', 'assistant', 'Violet scatters even more than blue, yet the sky is not violet.')],
    createdAt: 0,
    rev: 0,
  }
  const all = [root, ...threads.map((thread) => ({ ...thread, parentId: thread.parentId === 'root' ? root.id : thread.parentId }))]
  return {
    id,
    title,
    createdAt: 0,
    updatedAt: 0,
    titleLocked: true,
    treeState: { threads: Object.fromEntries(all.map((thread) => [thread.id, thread])), rootId: root.id, activeThreadId: root.id, expanded: {} },
  }
}

const violet = { messageId: 'm2', start: 0, end: 36, quote: 'Violet scatters even more than blue' }

test('significant terms drop stopwords and lens words, fold case and plurals', () => {
  assert.deepEqual([...significantTerms('Why doesn’t the sky look VIOLET? Explain the scatters.')], ['sky', 'look', 'violet', 'scatter'])
  assert.deepEqual([...significantTerms('what is it')], [])
})

test('a question sharing most of its terms with a branch matches it, in this chat or another', () => {
  const here = session('s1', 'Why is the sky blue?', [branch('b1', 'root', 'So why isn’t the sky violet?', violet)])
  const there = session('s2', 'How do we see colour?', [branch('x1', 'root', 'Why do cones overlap so much?', { messageId: 'm2', start: 0, end: 6, quote: 'Violet' })])
  const matches = exploredMatches([here, there], { text: 'why is the sky not violet', sessionId: 's1' })
  assert.equal(matches[0]?.threadId, 'b1')
  assert.equal(matches[0]?.chatTitle, undefined)
  const elsewhere = exploredMatches([here, there], { text: 'overlapping cones', sessionId: 's1' })
  assert.deepEqual(elsewhere.map((match) => [match.threadId, match.chatTitle]), [['x1', 'How do we see colour?']])
})

test('one shared word of a longer question is not a match', () => {
  const here = session('s1', 'Sky', [branch('b1', 'root', 'Where does the fourth power come from?', violet)])
  assert.deepEqual(exploredMatches([here], { text: 'fourth moon of jupiter orbit', sessionId: 's1' }), [])
})

test('a passage overlapping an existing anchor matches straight away, before anything is typed', () => {
  const here = session('s1', 'Sky', [branch('b1', 'root', 'Tell me more', violet), branch('b2', 'root', 'Something else', { ...violet, start: 40, end: 50 })])
  const passage = { sessionId: 's1', threadId: 's1-root', messageId: 'm2', start: 20, end: 45 }
  const matches = exploredMatches([here], { passage, sessionId: 's1' })
  assert.deepEqual(matches.map((match) => [match.threadId, match.reason]), [['b1', 'passage'], ['b2', 'passage']])
  assert.deepEqual(exploredMatches([here], { passage: { ...passage, start: 36, end: 40 }, sessionId: 's1' }), [])
})

test('the takeaway comes along; excluded, unanswered and extra matches are left out', () => {
  const s = session('s1', 'Sky', [
    branch('b1', 'root', 'Why is the sky violet?', violet, 3),
    branch('b2', 'root', 'Is the sky violet at dawn?', violet, 2),
    branch('b3', 'root', 'Violet sky at dusk?', violet, 1),
    { ...branch('b4', 'root', 'Violet sky again?', violet), messages: [message('q', 'user', 'Violet sky again?')] },
  ])
  const root = s.treeState.threads[s.treeState.rootId]!
  root.messages.push(message('t1', 'assistant', 'Our eyes weigh violet weakly.', { kind: 'drop-summary', sourceThreadId: 'b2' }))
  const matches = exploredMatches([s], { text: 'violet sky', sessionId: 's1', excludeThreadIds: ['b1'] })
  assert.deepEqual(matches.map((match) => match.threadId), ['b2', 'b3'])
  assert.equal(matches[0]?.takeaway, 'Our eyes weigh violet weakly.')
})
