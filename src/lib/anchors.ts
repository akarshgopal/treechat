import type { Anchor, AnchorRegion, AnchorSource } from '@/types'
import { parseAttachments } from './attachments/parse.ts'

/**
 * Anchors beyond message text: a passage of a cited page or document, or a
 * region of an attached image. Plain anchors stay exactly as they were.
 */

/** Characters of source text on each side of a passage sent with it. */
export const SOURCE_CONTEXT_CHARS = 600

/** Anchored in the message's own text (so its offsets underline it). */
export function isTextAnchor(anchor: Anchor | null | undefined): anchor is Anchor {
  return Boolean(anchor && !anchor.source && !anchor.region)
}

/**
 * What an anchor's offsets count in: '' for the message itself, else the
 * source or image. Two anchors overlap only within the same one.
 */
export function anchorSourceKey(anchor: { source?: Pick<AnchorSource, 'kind' | 'title' | 'url' | 'documentId'>; region?: Pick<AnchorRegion, 'attachmentId'> } | null | undefined): string {
  if (anchor?.region) return `image:${anchor.region.attachmentId}`
  const source = anchor?.source
  if (!source) return ''
  return source.kind === 'document' ? `document:${source.documentId ?? source.title}` : `web:${source.url ?? source.title}`
}

/** The source's text around `[start, end)`, at most `chars` on each side, cut at word edges. */
export function surroundingText(text: string, start: number, end: number, chars = SOURCE_CONTEXT_CHARS): string {
  let from = Math.max(0, start - chars)
  let to = Math.min(text.length, end + chars)
  if (from > 0) {
    const space = text.indexOf(' ', from)
    if (space >= 0 && space < start) from = space + 1
  }
  if (to < text.length) {
    const space = text.lastIndexOf(' ', to)
    if (space > end) to = space
  }
  const body = text.slice(from, to).replace(/\s+/g, ' ').trim()
  return `${from > 0 ? '…' : ''}${body}${to < text.length ? '…' : ''}`
}

/** Where the passage sits in the text it was selected in: the message, or the source. */
export function anchorSpan(anchor: Anchor): { start: number; end: number } {
  return anchor.source ? { start: anchor.source.start, end: anchor.source.end } : { start: anchor.start, end: anchor.end }
}

/** "From atmosphere-notes.pdf" above a branch's anchor; null for message text. */
export function anchorLabel(anchor: Anchor | null | undefined): string | null {
  if (anchor?.source) return `From ${anchor.source.title}`
  if (anchor?.region) return `From ${anchor.region.name}`
  return null
}

const fraction = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1

function parseSource(value: unknown): AnchorSource | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (record.kind !== 'web' && record.kind !== 'document') return undefined
  if (typeof record.title !== 'string') return undefined
  if (typeof record.start !== 'number' || typeof record.end !== 'number' || !(record.start <= record.end)) return undefined
  const text = (key: string) => (typeof record[key] === 'string' && record[key] ? { [key]: record[key] as string } : {})
  return { kind: record.kind, title: record.title, start: record.start, end: record.end, ...text('url'), ...text('documentId'), ...text('locator'), ...text('citationId'), ...text('context'), ...text('throughMessageId') }
}

function parseRegion(value: unknown): AnchorRegion | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (typeof record.attachmentId !== 'string' || typeof record.name !== 'string') return undefined
  const { x, y, w, h } = record
  if (!fraction(x) || !fraction(y) || !fraction(w) || !fraction(h)) return undefined
  const crop = parseAttachments(record.crop ? [record.crop] : undefined)?.[0]
  return { attachmentId: record.attachmentId, name: record.name, x: x as number, y: y as number, w: w as number, h: h as number, ...(crop ? { crop } : {}) }
}

/** The optional parts of a stored anchor, validated. */
export function parseAnchorExtras(record: Record<string, unknown>): Pick<Anchor, 'source' | 'region'> {
  const source = parseSource(record.source)
  const region = source ? undefined : parseRegion(record.region)
  return { ...(source ? { source } : {}), ...(region ? { region } : {}) }
}

/** Attachments a branch anchor keeps alive: an image region's crop. */
export function anchorAttachmentIds(anchor: Anchor | null | undefined): string[] {
  return anchor?.region?.crop ? [anchor.region.crop.id] : []
}

export type Point = { x: number; y: number }
export type Box = { left: number; top: number; width: number; height: number }

/** Smallest region worth asking about, in pixels on screen. */
export const MIN_REGION_PX = 8

/** A drag from `a` to `b` over `bounds`, as a rectangle in fractions; null when too small. */
export function regionFromDrag(a: Point, b: Point, bounds: Box): Pick<AnchorRegion, 'x' | 'y' | 'w' | 'h'> | null {
  const clampX = (value: number) => Math.min(Math.max(value, bounds.left), bounds.left + bounds.width)
  const clampY = (value: number) => Math.min(Math.max(value, bounds.top), bounds.top + bounds.height)
  const left = Math.min(clampX(a.x), clampX(b.x))
  const right = Math.max(clampX(a.x), clampX(b.x))
  const top = Math.min(clampY(a.y), clampY(b.y))
  const bottom = Math.max(clampY(a.y), clampY(b.y))
  if (right - left < MIN_REGION_PX || bottom - top < MIN_REGION_PX || bounds.width <= 0 || bounds.height <= 0) return null
  const round = (value: number) => Math.round(value * 10_000) / 10_000
  return {
    x: round((left - bounds.left) / bounds.width),
    y: round((top - bounds.top) / bounds.height),
    w: round((right - left) / bounds.width),
    h: round((bottom - top) / bounds.height),
  }
}

/** A region in pixels of an image `width` × `height`, at least one pixel. */
export function cropBox(region: Pick<AnchorRegion, 'x' | 'y' | 'w' | 'h'>, width: number, height: number) {
  const left = Math.min(width - 1, Math.max(0, Math.floor(region.x * width)))
  const top = Math.min(height - 1, Math.max(0, Math.floor(region.y * height)))
  return {
    left,
    top,
    width: Math.max(1, Math.min(width - left, Math.round(region.w * width))),
    height: Math.max(1, Math.min(height - top, Math.round(region.h * height))),
  }
}

/** A region's short description, used as its quote. */
export function regionQuote(name: string): string {
  return `A region of ${name}`
}

