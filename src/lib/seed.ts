import type { Branch, ChatMessage, TreeState } from '@/types'

const t0 = Date.parse('2026-04-12T15:04:00Z')

function at(offsetMinutes: number) {
  return t0 + offsetMinutes * 60_000
}

const assistantIntro = `TreeChat is a branching conversation. The main thread is the spine — the trunk you keep returning to. When a reply goes wide, select any passage and grow a side-thread from it, anchored to that exact character range plus the quote.`

const quote = 'select any passage and grow a side-thread from it'
const quoteStart = assistantIntro.indexOf(quote)
const quoteEnd = quoteStart + quote.length

export const seedSpine: ChatMessage[] = [
  {
    id: 'msg-spine-1',
    role: 'user',
    content: 'What is TreeChat?',
    createdAt: at(0),
  },
  {
    id: 'msg-spine-2',
    role: 'assistant',
    content: assistantIntro,
    createdAt: at(1),
  },
  {
    id: 'msg-spine-3',
    role: 'user',
    content: 'How do I actually start a branch?',
    createdAt: at(2),
  },
  {
    id: 'msg-spine-4',
    role: 'assistant',
    content:
      'Highlight text in any message. A Branch chip floats over the selection — or press ⌘⇧B / Ctrl+Shift+B. Closed branches keep a quiet underline and a gutter pip with the reply count. Hover the pip for a preview; click to open. Only one inline thread is open at a time.',
    createdAt: at(3),
  },
  {
    id: 'msg-spine-5',
    role: 'user',
    content: 'If a branch is open, does the main composer post into it?',
    createdAt: at(4),
  },
  {
    id: 'msg-spine-6',
    role: 'assistant',
    content:
      'No. The bottom composer always posts to the spine. While an inline branch is open you’ll see a banner: “Posting to main · switch to branch.” That switch focuses the branch’s own composer. Open as conversation is the other mode — then the composer posts only to the tangent, with Back to spine, the quote as context, and Esc (dirty blur, then back).',
    createdAt: at(5),
  },
]

export const seedBranch: Branch = {
  id: 'branch-seed-1',
  sourceMessageId: 'msg-spine-2',
  start: quoteStart,
  end: quoteEnd,
  quote,
  createdAt: at(6),
  messages: [
    {
      id: 'msg-branch-1',
      role: 'user',
      content:
        'If I keep talking on the spine, does this side-thread lose its place in the original sentence?',
      createdAt: at(6),
    },
    {
      id: 'msg-branch-2',
      role: 'assistant',
      content:
        'No. The branch is pinned to a character range and stores the quote. The underline stays on that span even as later spine messages stack below. Drop summary into main when the tangent is done; Discard removes it after a confirm.',
      createdAt: at(7),
    },
  ],
}

export function createSeedState(): TreeState {
  return {
    spine: seedSpine,
    branches: [seedBranch],
    openBranchId: null,
    view: { kind: 'spine' },
  }
}
