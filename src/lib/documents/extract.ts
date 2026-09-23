import type { DocumentFormat, ExtractedDocument, TextBlock } from './types.ts'

const MARKDOWN_EXTENSIONS = /\.(md|markdown|mdx|mdown|mkd)$/i
const TEXT_EXTENSIONS = /\.(txt|text|log|csv|tsv|json|ya?ml|xml|html?|rst|org|tex)$/i

/** Which extractor a file needs, or null when we cannot read it. */
export function formatOf(name: string, mime = ''): DocumentFormat | null {
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf'
  if (mime === 'text/markdown' || MARKDOWN_EXTENSIONS.test(name)) return 'markdown'
  if (mime.startsWith('text/') || TEXT_EXTENSIONS.test(name)) return 'text'
  return null
}

export const ACCEPTED_FILES = '.pdf,.md,.markdown,.mdx,.txt,.text,.log,.csv,.json,.yaml,.yml,.rst,.org,.tex,application/pdf,text/*'

function normalize(text: string) {
  // BOM and Windows line endings would otherwise leak into excerpts.
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
}

export function extractPlainText(text: string): ExtractedDocument {
  const body = normalize(text).trim()
  return { format: 'text', blocks: body ? [{ text: body }] : [] }
}

/**
 * One block per heading section, so each chunk knows the heading it sits
 * under. `#` inside fenced code is code, not a heading.
 */
export function extractMarkdown(text: string): ExtractedDocument {
  const lines = normalize(text).split('\n')
  const blocks: TextBlock[] = []
  let heading: string | undefined
  let current: string[] = []
  let fence: string | null = null

  const flush = () => {
    const body = current.join('\n').trim()
    if (body) blocks.push(heading ? { text: body, heading } : { text: body })
    current = []
  }

  // Front matter is metadata, not prose worth retrieving.
  let start = 0
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
    if (end > 0) start = end + 1
  }

  for (const line of lines.slice(start)) {
    const fenceMatch = /^\s*(```|~~~)/.exec(line)
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1]!
      else if (fenceMatch[1] === fence) fence = null
      current.push(line)
      continue
    }
    const headingMatch = fence ? null : /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)
    if (headingMatch) {
      flush()
      heading = headingMatch[1]!.trim()
    }
    current.push(line)
  }
  flush()
  return { format: 'markdown', blocks }
}

/** Read any supported file. PDF support loads pdf.js on first use. */
export async function extractFile(file: Blob & { name: string }): Promise<ExtractedDocument> {
  const format = formatOf(file.name, file.type)
  if (format === 'pdf') {
    const { extractPdf } = await import('./pdf.ts')
    return extractPdf(new Uint8Array(await file.arrayBuffer()))
  }
  if (!format) throw new Error('Only PDF, Markdown, and text files can be added.')
  const text = await file.text()
  return format === 'markdown' ? extractMarkdown(text) : extractPlainText(text)
}
