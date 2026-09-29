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

test('one shared word of a longer question is not a match', () => {
  const here = session('s1', 'Sky', [branch('b1', 'root', 'Where does the fourth power come from?', violet)])
  assert.deepEqual(exploredMatches([here], { text: 'fourth moon of jupiter orbit', sessionId: 's1' }), [])
})
