import type { Attachment } from '@/types'

/** Keep only well-formed attachment records (from storage or engine metadata). */
export function parseAttachments(value: unknown): Attachment[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: Attachment[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    if (typeof record.id !== 'string' || !record.id || seen.has(record.id)) continue
    if (record.kind !== 'image' && record.kind !== 'text') continue
    if (typeof record.name !== 'string' || typeof record.mime !== 'string') continue
    if (typeof record.size !== 'number' || !Number.isFinite(record.size)) continue
    seen.add(record.id)
    const attachment: Attachment = { id: record.id, kind: record.kind, name: record.name, mime: record.mime, size: record.size }
    if (typeof record.width === 'number') attachment.width = record.width
    if (typeof record.height === 'number') attachment.height = record.height
    out.push(attachment)
  }
  return out.length > 0 ? out : undefined
}

export function sameAttachments(a: Attachment[] | undefined, b: Attachment[] | undefined): boolean {
  const left = a ?? []
  const right = b ?? []
  return left.length === right.length && left.every((attachment, index) => attachment.id === right[index]!.id)
}

/** "screenshot.png · 1280×720" — how an attachment is named in text. */
export function attachmentLabel(attachment: Attachment): string {
  const size = attachment.width && attachment.height ? ` · ${attachment.width}×${attachment.height}` : ''
  return `${attachment.name}${size}`
}
