import type { MessageUsage } from '@/types'

/** A stored usage record, validated; undefined when unusable. */
export function parseUsage(value: unknown): MessageUsage | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const count = (field: unknown) => (typeof field === 'number' && Number.isFinite(field) && field >= 0 ? field : undefined)
  const promptTokens = count(record.promptTokens)
  const completionTokens = count(record.completionTokens)
  if (promptTokens === undefined || completionTokens === undefined) return undefined
  const cost = count(record.cost)
  return {
    promptTokens,
    completionTokens,
    ...(cost !== undefined ? { cost } : {}),
    ...(typeof record.model === 'string' && record.model ? { model: record.model } : {}),
  }
}

/**
 * The `usage` OpenRouter adds to the last streamed chunk (tokens, and `cost`
 * in USD credits), with the model that actually answered.
 */
export function usageFromOpenRouterChunk(event: unknown): MessageUsage | undefined {
  if (!event || typeof event !== 'object') return undefined
  const record = event as { usage?: Record<string, unknown>; model?: unknown }
  if (!record.usage) return undefined
  return parseUsage({
    promptTokens: record.usage.prompt_tokens,
    completionTokens: record.usage.completion_tokens,
    cost: record.usage.cost,
    model: record.model,
  })
}

export const sameUsage = (a: MessageUsage | undefined, b: MessageUsage | undefined) =>
  a?.promptTokens === b?.promptTokens && a?.completionTokens === b?.completionTokens && a?.cost === b?.cost && a?.model === b?.model

/** "$0.0031", "<$0.0001", "free" */
export function formatCost(cost: number): string {
  if (cost === 0) return 'free'
  if (cost < 0.0001) return '<$0.0001'
  return `$${cost < 0.01 ? cost.toPrecision(2) : cost.toFixed(cost < 1 ? 3 : 2)}`
}

/** "1.2k" */
export function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${+(tokens / 1000).toFixed(1)}k` : String(tokens)
}

/**
 * Usage of the reply streaming in each thread, waiting to be attached to it
 * when the reply finishes — the same hand-off as run citations.
 */
const pendingByThread = new Map<string, MessageUsage>()

export function clearRunUsage(threadId: string) {
  pendingByThread.delete(threadId)
}

export function recordRunUsage(threadId: string, usage: MessageUsage) {
  pendingByThread.set(threadId, usage)
}

export function takeRunUsage(threadId: string): MessageUsage | undefined {
  const usage = pendingByThread.get(threadId)
  pendingByThread.delete(threadId)
  return usage
}
