import type { AnswerAlternate, ChatMessage } from '@/types'
import { parseCitations, sameCitations } from './citations.ts'
import { parseUsage, sameUsage } from './usage.ts'

/**
 * Alternative answers on one reply. The message itself is always the current
 * answer; the others ride along in `alternates`, oldest first, and
 * `answerIndex` says where the current one sits among them all.
 */

/** A message's current answer, as an alternate. */
export function asAlternate(message: ChatMessage): AnswerAlternate {
  return {
    content: message.content,
    createdAt: message.createdAt,
    ...(message.citations ? { citations: message.citations } : {}),
    ...(message.usage ? { usage: message.usage } : {}),
    ...(message.model ? { model: message.model } : {}),
  }
}

/** Every answer of a reply in order, the current one included. */
export function answersOf(message: ChatMessage): AnswerAlternate[] {
  const others = message.alternates ?? []
  const at = currentIndex(message)
  return [...others.slice(0, at), asAlternate(message), ...others.slice(at)]
}

export function currentIndex(message: ChatMessage): number {
  const count = message.alternates?.length ?? 0
  const at = message.answerIndex ?? count
  return Math.min(Math.max(0, at), count)
}

/** The model that gave an answer, when known. */
export function answerModel(answer: Pick<AnswerAlternate, 'usage' | 'model'>): string | undefined {
  return answer.usage?.model ?? answer.model
}

/** `message` showing answer `index` instead; the same message when out of range. */
export function switchAnswer(message: ChatMessage, index: number): ChatMessage {
  const all = answersOf(message)
  const next = all[index]
  if (!next || index === currentIndex(message)) return message
  const { citations: _c, usage: _u, model: _m, alternates: _a, answerIndex: _i, ...rest } = message
  return {
    ...rest,
    content: next.content,
    createdAt: next.createdAt,
    ...(next.citations ? { citations: next.citations } : {}),
    ...(next.usage ? { usage: next.usage } : {}),
    ...(next.model ? { model: next.model } : {}),
    alternates: all.filter((_, position) => position !== index),
    answerIndex: index,
  }
}

function parseAlternate(value: unknown): AnswerAlternate | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.content !== 'string') return null
  const citations = parseCitations(record.citations)
  const usage = parseUsage(record.usage)
  return {
    content: record.content,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
    ...(citations ? { citations } : {}),
    ...(usage ? { usage } : {}),
    ...(typeof record.model === 'string' && record.model ? { model: record.model } : {}),
  }
}

/** Stored alternates and position, validated; nothing when there are none. */
export function parseAlternates(alternates: unknown, answerIndex: unknown): Pick<ChatMessage, 'alternates' | 'answerIndex'> {
  if (!Array.isArray(alternates)) return {}
  const parsed = alternates.flatMap((entry) => parseAlternate(entry) ?? [])
  if (parsed.length === 0) return {}
  const index = typeof answerIndex === 'number' && Number.isInteger(answerIndex) && answerIndex >= 0 && answerIndex < parsed.length
    ? { answerIndex }
    : {}
  return { alternates: parsed, ...index }
}

export function sameAlternates(a: ChatMessage, b: ChatMessage): boolean {
  const x = a.alternates ?? []
  const y = b.alternates ?? []
  return currentIndex(a) === currentIndex(b) && a.model === b.model && x.length === y.length && x.every((entry, index) => {
    const other = y[index]!
    return entry.content === other.content && entry.model === other.model && sameUsage(entry.usage, other.usage) && sameCitations(entry.citations, other.citations)
  })
}

/*
 * Handing a regenerate's earlier answers to the reply that replaces them:
 * the thread's runner attaches them when the new reply finishes.
 */
const pending = new Map<string, AnswerAlternate[]>()

export function queueEarlierAnswers(threadId: string, answers: AnswerAlternate[]) {
  pending.set(threadId, answers)
}

export function takeEarlierAnswers(threadId: string): AnswerAlternate[] {
  const answers = pending.get(threadId) ?? []
  pending.delete(threadId)
  return answers
}

export function dropEarlierAnswers(threadId: string) {
  pending.delete(threadId)
}

/*
 * "Try another model": the model for a thread's next request only. Settings
 * stay as they are.
 */
const models = new Map<string, string>()

export function setNextModel(threadId: string, model: string) {
  models.set(threadId, model)
}


export function dropNextModel(threadId: string) {
  models.delete(threadId)
}

/** The override a run used, for the runner to note on the reply. */
const running = new Map<string, string>()

/** For the transport: the override for this request, if one was set. */
export function claimNextModel(threadId: string): string | undefined {
  const model = models.get(threadId)
  models.delete(threadId)
  if (model) running.set(threadId, model)
  else running.delete(threadId)
  return model
}

export function takeRunModel(threadId: string): string | undefined {
  const model = running.get(threadId)
  running.delete(threadId)
  return model
}
