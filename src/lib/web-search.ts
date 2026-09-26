import type { Citation } from '@/types'
import { safeHttpUrl } from './citation-markers.ts'

/**
 * Live web search for a branch, via OpenRouter's `web` plugin.
 *
 * Only threads with `webSearch: true` (the Source? lens or the composer's
 * globe) send the plugin: every search costs a small fee, even on free
 * models, so ordinary messages never search. The demo mock fakes a searched
 * reply instead.
 */
export const WEB_SEARCH_MAX_RESULTS = 5

/** Longest snippet kept from a result; enough to find it on the page. */
const SNIPPET_CHARS = 280

export function isWebSearch(forwardedProps: Record<string, unknown> | undefined): boolean {
  return forwardedProps?.webSearch === true
}

/**
 * Replaces OpenRouter's default instruction (cite with domain-named markdown
 * links) so replies use `[n]` markers that line up with the results — the
 * annotations come back in that order and become citations 1, 2, …
 */
export function webSearchPrompt(quote?: string): string {
  const focus = quote?.trim() ? ` The reader is asking about this passage: “${quote.trim()}”.` : ''
  return (
    'A web search was conducted. Incorporate the following web search results into your response.' +
    focus +
    ' Cite results with numbered markers in square brackets — [1], [2], … — where [1] is the first result listed below,' +
    ' [2] the second, and so on. Put the marker right after the claim it supports. Do not cite with markdown links or domain names.'
  )
}

type WebPlugin = { id: 'web'; max_results: number; search_prompt: string }

export function applyWebSearch<T extends object>(
  requestBody: T,
  forwardedProps: Record<string, unknown> | undefined,
): T | (T & { plugins: WebPlugin[] }) {
  if (!isWebSearch(forwardedProps)) return requestBody
  const quote = typeof forwardedProps?.quote === 'string' ? forwardedProps.quote : undefined
  return {
    ...requestBody,
    plugins: [{ id: 'web', max_results: WEB_SEARCH_MAX_RESULTS, search_prompt: webSearchPrompt(quote) }],
  }
}

export type WebSource = { url: string; title: string; snippet?: string }

function clipSnippet(content: unknown): string | undefined {
  if (typeof content !== 'string') return undefined
  const text = content.replace(/\s+/g, ' ').trim()
  if (!text) return undefined
  if (text.length <= SNIPPET_CHARS) return text
  // Cut on a word boundary; no ellipsis, so the snippet stays verbatim text.
  const cut = text.slice(0, SNIPPET_CHARS)
  const space = cut.lastIndexOf(' ')
  return space > SNIPPET_CHARS / 2 ? cut.slice(0, space) : cut
}

function sourceFromAnnotation(annotation: unknown): WebSource | null {
  if (!annotation || typeof annotation !== 'object') return null
  const record = annotation as Record<string, unknown>
  if (record.type !== 'url_citation') return null
  // Documented shape nests the fields; accept them flat as well.
  const inner = (record.url_citation && typeof record.url_citation === 'object' ? record.url_citation : record) as Record<string, unknown>
  const url = safeHttpUrl(typeof inner.url === 'string' ? inner.url : undefined)
  if (!url) return null
  const title = typeof inner.title === 'string' && inner.title.trim() ? inner.title.trim() : new URL(url).hostname.replace(/^www\./, '')
  const snippet = clipSnippet(inner.content)
  return snippet ? { url, title, snippet } : { url, title }
}

/**
 * URL citations in one parsed OpenRouter stream event. They may arrive on
 * streamed deltas or on a final `message`; both are read.
 */
export function webSourcesFromChunk(chunk: unknown): WebSource[] {
  if (!chunk || typeof chunk !== 'object') return []
  const choices = (chunk as { choices?: unknown }).choices
  if (!Array.isArray(choices)) return []
  const out: WebSource[] = []
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') continue
    for (const key of ['delta', 'message'] as const) {
      const part = (choice as Record<string, unknown>)[key]
      const annotations = part && typeof part === 'object' ? (part as { annotations?: unknown }).annotations : undefined
      if (!Array.isArray(annotations)) continue
      for (const annotation of annotations) {
        const source = sourceFromAnnotation(annotation)
        if (source) out.push(source)
      }
    }
  }
  return out
}

/**
 * Numbers a run's web sources in first-seen order, one per URL, so `[1]` is
 * the first result the model was shown.
 */
export function createWebCitationCollector() {
  const byUrl = new Map<string, Citation>()
  return {
    /** Read one stream event; true when it added or filled in a source. */
    add(chunk: unknown): boolean {
      let added = false
      for (const source of webSourcesFromChunk(chunk)) {
        const known = byUrl.get(source.url)
        if (known) {
          // A later event may carry the text an earlier one lacked.
          if (!known.snippet && source.snippet) {
            known.snippet = source.snippet
            added = true
          }
          continue
        }
        byUrl.set(source.url, { id: String(byUrl.size + 1), kind: 'web', ...source })
        added = true
      }
      return added
    },
    citations(): Citation[] {
      return [...byUrl.values()].map((citation) => ({ ...citation }))
    },
  }
}
