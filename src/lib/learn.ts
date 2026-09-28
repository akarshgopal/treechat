import type { TreeState } from '@/types'
import { compactTranscript } from './compaction.ts'
import { branchTakeaway, childThreads, clipText, descendantIds, threadTitle } from './tree.ts'

/**
 * "What did I learn?": a Markdown summary of an exploration. On the main
 * thread it covers the whole chat; in a branch, that branch and everything
 * beneath it.
 */

/** Opens every summary request; the demo stream recognises it. */
export const LEARN_REQUEST = 'Summarize what I learned in this TreeChat exploration.'

/** Most of a request goes to transcripts; each thread gets a fair share. */
const LEARN_BUDGET = 24_000
const LEARN_MIN_PER_THREAD = 600

export type LearnScope = {
  /** The thread the summary starts from. */
  threadId: string
  title: string
  /** It, then its descendants, depth first. */
  threadIds: string[]
}

/** From `threadId` down: the main thread (or an unknown id) means the whole chat. */
export function learnScope(state: TreeState, threadId: string, chatTitle: string): LearnScope {
  const start = state.threads[threadId]?.parentId ? threadId : state.rootId
  const thread = state.threads[start]
  const threadIds: string[] = []
  const walk = (id: string) => {
    threadIds.push(id)
    for (const child of childThreads(state, id)) walk(child.id)
  }
  walk(start)
  return { threadId: start, title: thread?.parentId ? threadTitle(thread) : chatTitle, threadIds }
}

/**
 * The request: instructions, then the exploration as an outline. `TITLE:`,
 * `BRANCH:` and `TAKEAWAY:` lines keep it readable for the model and let the
 * demo answer from it.
 */
export function learnPrompt(state: TreeState, scope: LearnScope): string {
  const threads = scope.threadIds.flatMap((id) => (state.threads[id] ? [state.threads[id]] : []))
  const perThread = Math.max(LEARN_MIN_PER_THREAD, Math.floor(LEARN_BUDGET / Math.max(1, threads.length)))
  const depthOf = (id: string) => {
    let depth = 0
    for (let current = state.threads[id]; current && current.id !== scope.threadId && current.parentId; current = state.threads[current.parentId]) depth += 1
    return depth
  }
  const sections = threads.map((thread) => {
    const takeaway = branchTakeaway(state, thread.id)
    const transcript = compactTranscript({
      ...thread,
      // Takeaways are listed with their branch, not repeated in the parent.
      messages: thread.messages.filter((message) => message.kind !== 'drop-summary'),
    })
    const lines = [
      thread.id === scope.threadId ? `TITLE: ${scope.title}` : `${'  '.repeat(depthOf(thread.id) - 1)}BRANCH: ${threadTitle(thread)}`,
      ...(thread.id !== scope.threadId && thread.anchor ? [`About: «${clipText(thread.anchor.quote, 200)}»`] : []),
      ...(takeaway && thread.id !== scope.threadId ? [`TAKEAWAY: ${clipText(takeaway, 600)}`] : []),
      transcript.length > perThread ? `${transcript.slice(0, perThread - 1).trimEnd()}…` : transcript,
    ]
    return lines.filter((line) => line.trim()).join('\n')
  })
  return [
    LEARN_REQUEST,
    'Write Markdown with exactly three parts and no preamble: a lead paragraph of two to four sentences on what the exploration found; then "## Takeaways", a bullet per branch that concluded something, starting with the branch title in bold (prefer its TAKEAWAY when there is one); then "## Also explored", a short bullet per remaining branch. Leave a section out when it would be empty.',
    'Exploration:',
    ...sections,
  ].join('\n\n')
}

/** Whether a scope has any branches to talk about. */
export function scopeBranchCount(state: TreeState, threadId: string): number {
  return descendantIds(state, threadId).length - 1
}

/** A file name for the summary, from its title. */
export function learnFileName(title: string): string {
  const slug = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return `${slug || 'treechat'}-what-i-learned.md`
}
