import type { ChatMessage, Thread, TreeState } from '@/types'

const t0 = Date.parse('2026-04-12T15:04:00Z')

function at(offsetMinutes: number) {
  return t0 + offsetMinutes * 60_000
}

const assistantIntro = `TreeChat is a branching conversation. Every thread is a full conversation — the root one is just the thread without a parent. When a reply goes wide, select any passage and grow a side-thread from it, anchored to that exact character range plus the quote.`

const rootQuote = 'select any passage and grow a side-thread from it'
const rootQuoteStart = assistantIntro.indexOf(rootQuote)

const branchAnswer =
  'No. The branch is pinned to a character range and stores the quote, so the underline stays on that span as later messages stack below. It carries the whole chain above it as context, so it knows what you were talking about. And because a branch is just a thread, you can select a passage in here and branch again — there is no depth limit.'

const nestedQuote = 'you can select a passage in here and branch again'
const nestedQuoteStart = branchAnswer.indexOf(nestedQuote)

const rootMessages: ChatMessage[] = [
  {
    id: 'msg-root-1',
    role: 'user',
    content: 'What is TreeChat?',
    createdAt: at(0),
  },
  {
    id: 'msg-root-2',
    role: 'assistant',
    content: assistantIntro,
    createdAt: at(1),
  },
  {
    id: 'msg-root-3',
    role: 'user',
    content: 'How do I actually start a branch?',
    createdAt: at(2),
  },
  {
    id: 'msg-root-4',
    role: 'assistant',
    content:
      'Highlight text in any message, in any thread. A “branch from selection” chip floats over the selection — or press ⌘⇧B / Ctrl+Shift+B. Closed branches keep a quiet underline, and a pill sits on the hairline below the message with the quote and its reply count. Several branches can hang off the same passage; the underline doubles and the pill numbers them.',
    createdAt: at(3),
  },
  {
    id: 'msg-root-5',
    role: 'user',
    content: 'Which thread does the composer post to?',
    createdAt: at(4),
  },
  {
    id: 'msg-root-6',
    role: 'assistant',
    content:
      'Whichever thread it sits in. Every thread has its own composer — the one at the bottom belongs to the thread holding the frame, and an expanded branch carries its own inside its card. “Open as chat” gives a branch the full frame, with the tree rail beside it and the path in the header. Esc walks back up one level.',
    createdAt: at(5),
  },
]

const branchMessages: ChatMessage[] = [
  {
    id: 'msg-branch-1',
    role: 'user',
    content:
      'If I keep talking on the main thread, does this side-thread lose its place in the original sentence?',
    createdAt: at(6),
  },
  {
    id: 'msg-branch-2',
    role: 'assistant',
    content: branchAnswer,
    createdAt: at(7),
  },
]

const nestedMessages: ChatMessage[] = [
  {
    id: 'msg-nested-1',
    role: 'user',
    content: 'So how deep does this actually go?',
    createdAt: at(8),
  },
  {
    id: 'msg-nested-2',
    role: 'assistant',
    content:
      'As deep as you like — this thread is itself a branch of a branch. Each level carries the chain above it as context, so the model still knows what the original question was. Past two levels the inline cards stop nesting and offer “open as chat” instead, so the reading column never turns into a staircase.',
    createdAt: at(9),
  },
]

export function createSeedState(): TreeState {
  const root: Thread = {
    id: 'thread-root',
    parentId: null,
    anchor: null,
    messages: rootMessages,
    createdAt: at(0),
    rev: 0,
  }
  const branch: Thread = {
    id: 'thread-branch-1',
    parentId: root.id,
    anchor: {
      messageId: 'msg-root-2',
      start: rootQuoteStart,
      end: rootQuoteStart + rootQuote.length,
      quote: rootQuote,
    },
    messages: branchMessages,
    createdAt: at(6),
    rev: 0,
  }
  const nested: Thread = {
    id: 'thread-branch-1-1',
    parentId: branch.id,
    anchor: {
      messageId: 'msg-branch-2',
      start: nestedQuoteStart,
      end: nestedQuoteStart + nestedQuote.length,
      quote: nestedQuote,
    },
    messages: nestedMessages,
    createdAt: at(8),
    rev: 0,
  }

  return {
    threads: {
      [root.id]: root,
      [branch.id]: branch,
      [nested.id]: nested,
    },
    rootId: root.id,
    activeThreadId: root.id,
    expanded: {},
  }
}
