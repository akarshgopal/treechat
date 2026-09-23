import type { Citation } from '@/types'

/**
 * Keep only well-formed citations. Used when reading storage and chat-engine
 * metadata, so a malformed entry never reaches rendering.
 */
export function parseCitations(value: unknown): Citation[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: Citation[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    if (typeof record.id !== 'string' || !record.id || seen.has(record.id)) continue
    if (record.kind !== 'web' && record.kind !== 'document') continue
    if (typeof record.title !== 'string') continue
    seen.add(record.id)
    const citation: Citation = { id: record.id, kind: record.kind, title: record.title }
    if (typeof record.url === 'string') citation.url = record.url
    if (typeof record.documentId === 'string') citation.documentId = record.documentId
    if (typeof record.locator === 'string') citation.locator = record.locator
    if (typeof record.snippet === 'string') citation.snippet = record.snippet
    out.push(citation)
  }
  return out.length > 0 ? out : undefined
}

/** Same sources in the same order; used to decide whether a transcript changed. */
export function sameCitations(a: Citation[] | undefined, b: Citation[] | undefined): boolean {
  const left = a ?? []
  const right = b ?? []
  return left.length === right.length && left.every((citation, index) => {
    const other = right[index]!
    return citation.id === other.id && citation.url === other.url && citation.documentId === other.documentId
  })
}

/**
 * Citations produced while a reply streams, waiting to be attached to it.
 *
 * Transports (web search, document retrieval) call `recordRunCitations` for
 * the thread they are answering; `runChat` clears the slot when a run starts;
 * the thread's chat engine takes them when the reply finishes and stores them
 * on that assistant message. Keyed by thread id: one run per thread at a time.
 */
const pendingByThread = new Map<string, Citation[]>()

export function clearRunCitations(threadId: string) {
  pendingByThread.delete(threadId)
}

/** Add sources for the reply in flight; a repeated id replaces the earlier one. */
export function recordRunCitations(threadId: string, citations: Citation[]) {
  const merged = new Map((pendingByThread.get(threadId) ?? []).map((citation) => [citation.id, citation]))
  for (const citation of citations) merged.set(citation.id, citation)
  pendingByThread.set(threadId, [...merged.values()])
}

export function takeRunCitations(threadId: string): Citation[] | undefined {
  const citations = pendingByThread.get(threadId)
  pendingByThread.delete(threadId)
  return citations && citations.length > 0 ? citations : undefined
}
