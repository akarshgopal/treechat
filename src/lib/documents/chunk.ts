import { chunkId, type DocumentChunk, type TextBlock } from './types.ts'

export type ChunkOptions = {
  /** Target characters per chunk. */
  size?: number
  /** Characters repeated from the end of one chunk at the start of the next. */
  overlap?: number
}

type Unit = { text: string; sep: string; page?: number; heading?: string }

const SENTENCE_END = /(?<=[.!?…。])["')\]]*\s+(?=\S)/

/** Split text longer than `size` at the last space before the limit. */
function splitWords(text: string, size: number): string[] {
  const parts: string[] = []
  let rest = text
  while (rest.length > size) {
    const space = rest.lastIndexOf(' ', size)
    const cut = space > size / 2 ? space : size
    parts.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) parts.push(rest)
  return parts
}

/**
 * Break blocks into paragraphs, and paragraphs that are too long into
 * sentences (then words), so chunks end on natural boundaries.
 */
function unitsOf(blocks: TextBlock[], size: number): Unit[] {
  const units: Unit[] = []
  for (const block of blocks) {
    const where = { page: block.page, heading: block.heading }
    for (const paragraph of block.text.split(/\n\s*\n/)) {
      const text = paragraph.trim()
      if (!text) continue
      if (text.length <= size) {
        units.push({ text, sep: '\n\n', ...where })
        continue
      }
      let sep = '\n\n'
      for (const sentence of text.split(SENTENCE_END)) {
        for (const piece of splitWords(sentence.trim(), size)) {
          if (!piece) continue
          units.push({ text: piece, sep, ...where })
          sep = ' '
        }
      }
    }
  }
  return units
}

/** The last `overlap` characters, starting at a sentence or word boundary. */
function tail(text: string, overlap: number): string {
  if (overlap <= 0 || !text) return ''
  if (text.length <= overlap) return text
  const window = text.slice(-overlap)
  const sentence = window.search(/(?<=[.!?…])\s+\S/)
  if (sentence >= 0 && sentence < window.length * 0.7) return window.slice(sentence).trim()
  const space = window.indexOf(' ')
  return space >= 0 ? window.slice(space + 1) : window
}

export function locatorOf(pages: number[], heading?: string): string | undefined {
  if (pages.length > 0) {
    const first = Math.min(...pages)
    const last = Math.max(...pages)
    return first === last ? `p. ${first}` : `pp. ${first}–${last}`
  }
  return heading
}

/**
 * Pack paragraphs into ~`size`-character chunks. A new heading always starts
 * a chunk, so a citation never names the wrong section; a new page does once
 * the chunk is half full (short pages merge into "pp. 3–4"). Each chunk
 * repeats the tail of the previous one for context.
 */
export function chunkBlocks(
  documentId: string,
  blocks: TextBlock[],
  { size = 800, overlap = 150 }: ChunkOptions = {},
): DocumentChunk[] {
  const chunks: DocumentChunk[] = []
  let text = ''
  let lead = ''
  let pages: number[] = []
  let heading: string | undefined
  let started = false

  const emit = (carry: boolean) => {
    if (!started) return
    const index = chunks.length
    const chunk: DocumentChunk = { id: chunkId(documentId, index), documentId, index, text: text.trim() }
    const page = pages.length > 0 ? Math.min(...pages) : undefined
    if (page !== undefined) chunk.page = page
    if (heading) chunk.heading = heading
    const locator = locatorOf(pages, heading)
    if (locator) chunk.locator = locator
    chunks.push(chunk)
    // Overlap keeps a thought intact across a cut (PDF prose flows across
    // pages); a new section starts a new thought, so it is dropped there.
    lead = carry ? tail(text, overlap) : ''
    text = ''
    pages = []
    heading = undefined
    started = false
  }

  for (const unit of unitsOf(blocks, size)) {
    const section = started && unit.heading !== heading
    const moved = section || (started && unit.page !== undefined && !pages.includes(unit.page))
    const full = started && text.length + unit.sep.length + unit.text.length > size
    if (full || section || (moved && text.length >= size / 2)) emit(!section)
    if (!started) {
      started = true
      // The overlap leads the chunk but its place comes from the new text.
      text = lead ? `${lead}${unit.sep}${unit.text}` : unit.text
      heading = unit.heading
    } else {
      text += unit.sep + unit.text
    }
    if (unit.page !== undefined && !pages.includes(unit.page)) pages.push(unit.page)
  }
  emit(false)
  return chunks
}
