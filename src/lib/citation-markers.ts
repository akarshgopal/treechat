import type { Citation } from '@/types'
import type { HastChild, HastElement, HastRoot, HastText } from './markdown.ts'

/**
 * `[1]`-style markers in reply text. Only markers whose id belongs to one of
 * the message's citations become chips; anything else (`[sic]`, an unknown
 * number) stays plain text.
 */
const MARKER = /\[([^[\]\s]{1,12})\]/g

export type MarkerSegment = { text: string; citationId?: string }

export function splitCitationMarkers(text: string, ids: ReadonlySet<string>): MarkerSegment[] {
  const segments: MarkerSegment[] = []
  let last = 0
  for (const match of text.matchAll(MARKER)) {
    const id = match[1]!
    if (!ids.has(id)) continue
    const at = match.index ?? 0
    if (at > last) segments.push({ text: text.slice(last, at) })
    segments.push({ text: match[0], citationId: id })
    last = at + match[0].length
  }
  if (last < text.length || segments.length === 0) segments.push({ text: text.slice(last) })
  return segments
}

/** Code and links keep their text as written. */
const SKIP_TAGS = new Set(['code', 'pre', 'a'])

/**
 * The chip keeps the full marker as its text — brackets included, only styled
 * away — so the message's visible text (what branch anchors count over) is the
 * same whether or not the citations have arrived yet.
 */
function chipElement(marker: string, id: string): HastElement {
  return {
    type: 'element',
    tagName: 'sup',
    properties: { className: ['cite-ref'], dataCitationId: id },
    children: [
      { type: 'element', tagName: 'span', properties: { className: ['cite-bracket'] }, children: [{ type: 'text', value: '[' }] },
      { type: 'text', value: marker.slice(1, -1) },
      { type: 'element', tagName: 'span', properties: { className: ['cite-bracket'] }, children: [{ type: 'text', value: ']' }] },
    ],
  }
}

export function wrapCitationMarkers(tree: HastRoot | HastElement, ids: ReadonlySet<string>): void {
  if (ids.size === 0) return
  const next: HastChild[] = []
  let changed = false
  for (const child of tree.children ?? []) {
    if (child.type === 'text') {
      const segments = splitCitationMarkers((child as HastText).value, ids)
      if (segments.length === 1 && !segments[0]!.citationId) {
        next.push(child)
        continue
      }
      changed = true
      for (const segment of segments) {
        if (!segment.text) continue
        next.push(segment.citationId ? chipElement(segment.text, segment.citationId) : { type: 'text', value: segment.text })
      }
      continue
    }
    if (child.type === 'element' && !SKIP_TAGS.has((child as HastElement).tagName)) {
      wrapCitationMarkers(child as HastElement, ids)
    }
    next.push(child)
  }
  if (changed) tree.children = next
}

/** Rehype plugin; runs before branch marks so anchors can still span a chip. */
export function rehypeCitationMarkers(ids: ReadonlySet<string>) {
  return function attacher() {
    return function transform(tree: HastRoot) {
      wrapCitationMarkers(tree, ids)
    }
  }
}

/** Only http(s) links leave the app; anything else is not a source we open. */
export function safeHttpUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined
  } catch {
    return undefined
  }
}

export function sourceHost(url: string | undefined): string | undefined {
  const safe = safeHttpUrl(url)
  return safe ? new URL(safe).hostname.replace(/^www\./, '') : undefined
}

/** One line under a source's title: where it lives. */
export function citationWhere(citation: Citation): string {
  if (citation.kind === 'document') return citation.locator ?? 'Document'
  return [sourceHost(citation.url), citation.locator].filter(Boolean).join(' · ')
}
