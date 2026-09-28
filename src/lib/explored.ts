import type { ChatSession, Thread } from '@/types'
import { branchTakeaway, firstQuestion, threadTitle } from './tree.ts'
import { anchorSourceKey, anchorSpan } from './anchors.ts'

/**
 * "Explored before": branches, in any chat, about what the person is about to
 * ask. Runs offline on what is already saved: significant terms of the
 * question are compared with each branch's title, first question and quote,
 * and a passage that overlaps an existing branch's anchor matches outright.
 */

/** Common words, and the words of the lens questions, that say nothing about a topic. */
const STOPWORDS = new Set(`
a about above after again against all also am an and any are as at be because been before being below between both
but by can could did do does doing done down during each else ever few for from further get gets getting go goes
going got had has have having he her here hers herself him himself his how i if in into is isn it its itself just
kind let lets like made make makes many may me might mine more most much must my myself need no nor not now of off
often on once one only or other our ours ourselves out over own per please quite rather really said same say says
see seem seems she should show so some something such tell than that thats the their theirs them themselves then
there these they thing things think this those though through to too under until up upon us use used using very
was way we well were what whats when where whether which while who whom whose why will with within without would
yes yet you your yours yourself yourselves
dont doesnt didnt isnt arent wasnt werent cant couldnt wont wouldnt shouldnt hasnt havent im ive id youre theyre
explain example concrete strongest case simply simpler deeper evidence source mean means meaning versus vs
`.split(/\s+/).filter(Boolean))

/** "overlapp" (from "overlapping") → "overlap". */
function undouble(word: string): string {
  return /([b-df-hj-km-np-rtv-z])\1$/.test(word) && !/(ll|ss|zz)$/.test(word) ? word.slice(0, -1) : word
}

/** Light stemming, so "scatters" and "scattering" meet "scatter". */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 5 && word.endsWith('ing')) return undouble(word.slice(0, -3))
  if (word.length > 4 && word.endsWith('ed') && !word.endsWith('eed')) return undouble(word.slice(0, -2))
  if (word.length > 3 && word.endsWith('es') && /(ch|sh|x|ss|z)es$/.test(word)) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us') && !word.endsWith('is')) return word.slice(0, -1)
  return word
}

/** The words of `text` that carry its topic: folded, stemmed, without stopwords. */
export function significantTerms(text: string): Set<string> {
  const words = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/['’]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
  const terms = new Set<string>()
  for (const word of words) {
    if (word.length < 3 || STOPWORDS.has(word) || /^\d+$/.test(word)) continue
    terms.add(stem(word))
  }
  return terms
}

/** A passage being asked about: a branch anchored over it was explored before. */
export type ExploredPassage = {
  sessionId: string
  threadId: string
  messageId: string
  start: number
  end: number
  /** What the offsets count in (`anchorSourceKey`): '' for the message itself. */
  sourceKey?: string
}

type ExploredQuery = {
  /** The question being typed; may be empty. */
  text?: string
  passage?: ExploredPassage
  /** The open chat, to say "this chat" or name the other one. */
  sessionId: string
  /** Threads never offered (the one being typed in and those above it). */
  excludeThreadIds?: Iterable<string>
  limit?: number
}

export type ExploredMatch = {
  sessionId: string
  /** The chat it is in; unset for the open chat. */
  chatTitle?: string
  threadId: string
  title: string
  takeaway?: string
  /** Why it matched: the same passage, or the same topic. */
  reason: 'passage' | 'terms'
  score: number
}

const EXPLORED_LIMIT = 2

/** Threads are replaced, never changed, on every edit: their terms can be kept. */
const termsCache = new WeakMap<Thread, Set<string>>()

function branchTerms(thread: Thread): Set<string> {
  let terms = termsCache.get(thread)
  if (!terms) {
    terms = significantTerms([threadTitle(thread), firstQuestion(thread) ?? '', thread.anchor?.quote ?? ''].join(' '))
    termsCache.set(thread, terms)
  }
  return terms
}

/** Answered branches in any chat that match the query, best first, at most `limit`. */
export function exploredMatches(sessions: ChatSession[], query: ExploredQuery): ExploredMatch[] {
  const asked = significantTerms(query.text ?? '')
  // Nothing to compare: skip the scan (every empty composer asks on every change).
  if (asked.size === 0 && !query.passage) return []
  const excluded = new Set(query.excludeThreadIds ?? [])
  const out: Array<ExploredMatch & { createdAt: number }> = []
  for (const session of sessions) {
    const tree = session.treeState
    const sameChat = session.id === query.sessionId
    for (const thread of Object.values(tree.threads)) {
      if (!thread.parentId || !thread.anchor) continue
      if (sameChat && excluded.has(thread.id)) continue
      // Nothing was explored until a reply came back.
      if (!thread.messages.some((message) => message.role === 'assistant' && message.content.trim())) continue
      const passage = query.passage
      const overlaps = Boolean(passage)
        && passage!.sessionId === session.id
        && passage!.threadId === thread.parentId
        && passage!.messageId === thread.anchor.messageId
        && anchorSourceKey(thread.anchor) === (passage!.sourceKey ?? '')
        && anchorSpan(thread.anchor).start < passage!.end
        && passage!.start < anchorSpan(thread.anchor).end
      let score = 0
      if (overlaps) score = 2
      else if (asked.size > 0) {
        const terms = branchTerms(thread)
        let shared = 0
        for (const term of asked) if (terms.has(term)) shared += 1
        // Most of what is being asked, and never a single common word of a long question.
        if (shared >= Math.min(2, asked.size) && shared / asked.size >= 0.5) score = shared / asked.size + shared * 0.01
      }
      if (score === 0) continue
      const takeaway = branchTakeaway(tree, thread.id)
      out.push({
        sessionId: session.id,
        ...(sameChat ? {} : { chatTitle: session.title }),
        threadId: thread.id,
        title: threadTitle(thread),
        ...(takeaway ? { takeaway } : {}),
        reason: overlaps ? 'passage' : 'terms',
        score,
        createdAt: thread.createdAt,
      })
    }
  }
  return out
    .sort((a, b) => b.score - a.score || Number(!b.chatTitle) - Number(!a.chatTitle) || b.createdAt - a.createdAt)
    .slice(0, query.limit ?? EXPLORED_LIMIT)
    .map(({ createdAt: _createdAt, ...match }) => match)
}
