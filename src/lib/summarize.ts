import type { ChatMessage, ThreadSummary } from '@/types'
import { resolveChatBackend } from './client-chat.ts'
import { planCompaction, prefixFingerprint, type CompactionPlan } from './compaction.ts'
import { requestAssistantText } from './request-assistant.ts'
import { clipText } from './tree.ts'

/** Summaries in the demo stay short enough to read in the disclosure. */
const MOCK_SUMMARY_CHARS = 1600
/** A single catch-up never runs away on a huge imported thread. */
const MAX_PASSES = 4

export function summaryPrompt(plan: CompactionPlan): string {
  const transcript = plan.messages
    .map((message) => `${message.role}: ${message.content}`)
    .join('\n\n')
  return [
    'You maintain a running summary of the earlier part of a conversation, so it can continue without the full transcript.',
    plan.previous ? `Summary so far:\n${plan.previous}` : '',
    `Messages to fold in:\n${transcript}`,
    'Write the updated summary covering everything above. Keep facts, decisions, definitions, names, numbers, code identifiers, the user\'s goals and preferences, and open questions. Drop pleasantries. Under 350 words, plain prose or short bullets, no preamble.',
  ].filter(Boolean).join('\n\n')
}

/** No model in demo mode: a readable extract stands in for a real summary. */
export function mockSummary(plan: CompactionPlan): string {
  const lines = [
    ...(plan.previous ? plan.previous.split('\n') : []),
    ...plan.messages.map((message) => `- ${message.role}: ${clipText(message.content, 120)}`),
  ].filter((line) => line && line !== '…')
  // Keep the most recent lines that fit.
  const kept: string[] = []
  let length = 1
  for (let i = lines.length - 1; i >= 0 && length + lines[i].length + 1 <= MOCK_SUMMARY_CHARS; i -= 1) {
    kept.unshift(lines[i])
    length += lines[i].length + 1
  }
  return kept.length < lines.length ? ['…', ...kept].join('\n') : kept.join('\n')
}

async function summarize(plan: CompactionPlan, signal?: AbortSignal): Promise<string> {
  if (resolveChatBackend() === 'mock') return mockSummary(plan)
  return requestAssistantText(summaryPrompt(plan), undefined, undefined, signal, { background: true })
}

const running = new Set<string>()

/**
 * Bring a thread's summary up to date in the background. Never two at once
 * per thread; a failure keeps the old summary. `commit` receives each new
 * summary with the fingerprint of the messages it covers, so the store can
 * refuse it if the thread was rewritten meanwhile.
 */
export async function refreshSummary(
  threadId: string,
  messages: ChatMessage[],
  summary: ThreadSummary | undefined,
  commit: (summary: ThreadSummary, basis: string) => void,
): Promise<void> {
  if (running.has(threadId) || !planCompaction(messages, summary)) return
  running.add(threadId)
  try {
    let current = summary
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const plan = planCompaction(messages, current)
      if (!plan) break
      const content = (await summarize(plan)).trim()
      const basis = prefixFingerprint(messages, plan.throughMessageId)
      if (!content || !basis) break
      current = { content, throughMessageId: plan.throughMessageId, createdAt: Date.now() }
      commit(current, basis)
    }
  } catch {
    // Keep whatever summary the thread already has; the next reply retries.
  } finally {
    running.delete(threadId)
  }
}
