/**
 * Documents the person adds to TreeChat. Everything here lives in IndexedDB in
 * this browser; only retrieved excerpts ever reach a model, with a question.
 */

export type DocumentFormat = 'pdf' | 'markdown' | 'text'

export type DocumentStatus = 'indexing' | 'ready' | 'error'

export type StoredDocument = {
  id: string
  name: string
  format: DocumentFormat
  /** Bytes of the original file. */
  size: number
  /** PDFs only. */
  pages?: number
  createdAt: number
  status: DocumentStatus
  /** Why indexing failed, or why search fell back to keywords. */
  error?: string
  /**
   * The embedder whose vectors the chunks carry. Absent when the chunks have
   * no vectors (the model could not load), so search uses keywords instead.
   */
  embedderId?: string
  chunkCount: number
}

/** A contiguous run of text from one place in the source. */
export type TextBlock = {
  text: string
  /** 1-based PDF page. */
  page?: number
  /** Nearest Markdown heading above the block. */
  heading?: string
}

export type ExtractedDocument = {
  format: DocumentFormat
  blocks: TextBlock[]
  pages?: number
}

export type DocumentChunk = {
  /** `${documentId}:${index}` so a chunk can be fetched without a lookup. */
  id: string
  documentId: string
  index: number
  text: string
  page?: number
  heading?: string
  /** Human-readable place in the source, e.g. "p. 4" or "Setup". */
  locator?: string
  vector?: Float32Array
}

export function chunkId(documentId: string, index: number) {
  return `${documentId}:${index}`
}
