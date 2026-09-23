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
      'Highlight text in any message, in any thread. Choose “Branch” — or press ⌘⇧B / Ctrl+Shift+B — and write a question beside the passage. The branch is created when you send. You can also use the branch icon below any message. Closed branches keep a quiet underline so you can find your way back.',
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
      '“Expand” gives an exploration the full frame, with its source passage pinned above it. “Back to passage” returns you to that source and highlights it. When you find something useful, choose “Bring back”, edit the takeaway, and add it to the parent conversation. The exploration stays available through a link on the takeaway.',
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
      'As deep as you like — this thread is itself a branch of a branch. Each level carries upstream context. Past two levels the inline cards offer “Expand branch” for a comfortable reading width. On mobile, new branches open in their own full-width view. “Back to passage” takes you one level up to the exact source.',
    createdAt: at(9),
  },
]

/** A single empty root thread — a fresh chat with no demo messages or branches. */
export function createEmptyState(): TreeState {
  const root: Thread = {
    id: 'thread-root',
    parentId: null,
    anchor: null,
    messages: [],
    createdAt: Date.now(),
    rev: 0,
  }
  return {
    threads: { [root.id]: root },
    rootId: root.id,
    activeThreadId: root.id,
    expanded: {},
  }
}

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
