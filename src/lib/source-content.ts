import type { Citation } from '@/types'
import { safeHttpUrl } from './citation-markers.ts'

/**
 * What a source lane shows for a citation. Markdown renders as a page; text
 * renders as plain paragraphs. At least one must be non-empty.
 */
export type SourceContent = { markdown?: string; text?: string }

/**
 * Fetches the content behind a citation. Throw (or reject) when it cannot be
 * loaded — the lane then falls back to the citation's own title and snippet.
 * Honour `signal`: the lane aborts when it closes or switches source.
 */
export type SourceLoader = (citation: Citation, signal: AbortSignal) => Promise<SourceContent>

/** Thrown when there is nothing to show beyond what the citation already holds. */
export class SourceUnavailableError extends Error {
  constructor(message = 'This source could not be loaded.') {
    super(message)
    this.name = 'SourceUnavailableError'
  }
}

const loaders = new Map<Citation['kind'], SourceLoader>()

/**
 * Register the loader for one kind of citation, replacing any earlier one.
 * Returns a function that restores the previous loader.
 *
 *   registerSourceLoader('document', async (citation, signal) => ({ text: … }))
 */
export function registerSourceLoader(kind: Citation['kind'], loader: SourceLoader): () => void {
  const previous = loaders.get(kind)
  loaders.set(kind, loader)
  return () => {
    if (loaders.get(kind) !== loader) return
    if (previous) loaders.set(kind, previous)
    else loaders.delete(kind)
  }
}

function hasContent(content: SourceContent | undefined): content is SourceContent {
  return Boolean(content && (content.markdown?.trim() || content.text?.trim()))
}

/**
 * Load a citation's content with the loader registered for its kind. Rejects
 * with `SourceUnavailableError` when there is no loader or the result is
 * empty (the lane then shows the citation's own title and snippet), and
 * passes other loader errors (including aborts) through.
 */
export async function loadSourceContent(citation: Citation, signal: AbortSignal): Promise<SourceContent> {
  const loader = loaders.get(citation.kind)
  if (!loader) throw new SourceUnavailableError()
  const content = await loader(citation, signal)
  if (!hasContent(content)) throw new SourceUnavailableError()
  return content
}

/** Reader service that returns any public page as markdown. */
export const READER_ORIGIN = 'https://r.jina.ai/'

export function readerUrl(url: string): string {
  return `${READER_ORIGIN}${url}`
}

/** The reader prefixes its markdown with `Title:` / `URL Source:` lines. */
export function stripReaderPreamble(body: string): string {
  const marker = body.indexOf('Markdown Content:')
  return marker >= 0 ? body.slice(marker + 'Markdown Content:'.length).trim() : body.trim()
}

/**
 * Web pages via the reader. A plain GET with no custom headers keeps it a
 * CORS "simple request"; if the service still refuses the browser, the lane
 * shows the fallback.
 */
export const webReaderLoader: SourceLoader = async (citation, signal) => {
  const url = safeHttpUrl(citation.url)
  if (!url) throw new SourceUnavailableError('This source has no web address.')
  const response = await fetch(readerUrl(url), { signal })
  if (!response.ok) throw new SourceUnavailableError(`The reader answered ${response.status}.`)
  return { markdown: stripReaderPreamble(await response.text()) }
}

registerSourceLoader('web', webReaderLoader)

/**
 * Documents live in this browser's IndexedDB. The store is imported only when
 * a document source is opened, so plain chats never load it.
 */
export const documentLoader: SourceLoader = async (citation, signal) => {
  if (!citation.documentId) throw new SourceUnavailableError('This source has no document.')
  let doc, text
  try {
    const { getDocument, getDocumentText } = await import('./documents/store.ts')
    ;[doc, text] = await Promise.all([getDocument(citation.documentId), getDocumentText(citation.documentId)])
  } catch {
    throw new SourceUnavailableError('The document library could not be read in this browser.')
  }
  signal.throwIfAborted()
  if (!doc || !text.trim()) throw new SourceUnavailableError('This document is no longer in your library.')
  return doc.format === 'markdown' ? { markdown: text } : { text }
}

registerSourceLoader('document', documentLoader)

function normalize(text: string): { value: string; map: number[] } {
  // Collapse whitespace and fold case, remembering where each kept character
  // came from so a match maps back onto the original text.
  let value = ''
  const map: number[] = []
  let space = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!
    if (/\s/.test(char)) {
      if (!space && value) {
        value += ' '
        map.push(index)
      }
      space = true
      continue
    }
    space = false
    value += char.toLowerCase()
    map.push(index)
  }
  return { value, map }
}

/** Typographic quotes and dashes differ between a page and the model's quote. */
function fold(text: string) {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―]/g, '-')
}

/**
 * Where a cited snippet sits in a page's text, ignoring case and whitespace
 * differences. Falls back to the snippet's opening words, since pages often
 * differ from the quote further in. Null when nothing matches.
 */
export function locateSnippet(text: string, snippet: string | undefined): { start: number; end: number } | null {
  if (!snippet?.trim()) return null
  const haystack = normalize(fold(text))
  const needle = normalize(fold(snippet)).value.trim()
  const tries = [needle]
  const words = needle.split(' ')
  if (words.length > 8) tries.push(words.slice(0, 8).join(' '))
  for (const attempt of tries) {
    const at = haystack.value.indexOf(attempt)
    if (at < 0) continue
    const start = haystack.map[at]!
    const end = haystack.map[at + attempt.length - 1]! + 1
    return { start, end }
  }
  return null
}
