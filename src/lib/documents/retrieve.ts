import type { Citation } from '../../types.ts'
import { cosine, type Embedder } from './embedder.ts'
import { bm25Scores } from './keyword.ts'
import { getChunks, getDocument } from './store.ts'
import type { DocumentChunk, StoredDocument } from './types.ts'

export type RetrievedChunk = {
  chunk: DocumentChunk
  document: StoredDocument
  score: number
  method: 'vector' | 'keyword'
}

export type RetrieveOptions = {
  embedder: Embedder
  /** How many excerpts to return at most. */
  k?: number
  /**
   * How long a question waits for the embedding model (first use downloads
   * it) before answering from keywords instead.
   */
  timeoutMs?: number
}

/** Chunks never change once stored; a document's are cached until it is removed. */
const chunkCache = new Map<string, DocumentChunk[]>()

export function forgetCachedChunks(documentId?: string) {
  if (documentId) chunkCache.delete(documentId)
  else chunkCache.clear()
}

async function chunksOf(doc: StoredDocument) {
  let chunks = chunkCache.get(doc.id)
  if (!chunks) {
    chunks = await getChunks(doc.id)
    chunkCache.set(doc.id, chunks)
  }
  return chunks
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error: unknown) => { clearTimeout(timer); reject(error) },
    )
  })
}

/**
 * Keyword scores are unbounded; squash them into roughly the range of a good
 * cosine match so the two can share one ranking when a chat mixes documents
 * indexed with and without the model.
 */
function keywordScore(score: number) {
  return score / (score + 3)
}

/**
 * The best excerpts for `query` from the given documents. Brute-force cosine
 * over stored vectors; chunks without usable vectors (model failed, or a
 * different model indexed them) and a failed query embedding fall back to
 * BM25. Missing or still-indexing documents are skipped.
 */
export async function retrieve(
  query: string,
  documentIds: string[],
  { embedder, k = 5, timeoutMs = 10_000 }: RetrieveOptions,
): Promise<RetrievedChunk[]> {
  if (!query.trim() || documentIds.length === 0) return []
  const documents = (await Promise.all([...new Set(documentIds)].map((id) => getDocument(id))))
    .filter((doc): doc is StoredDocument => doc?.status === 'ready')
  if (documents.length === 0) return []

  const semantic: Array<{ chunk: DocumentChunk; document: StoredDocument }> = []
  const lexical: Array<{ chunk: DocumentChunk; document: StoredDocument }> = []
  for (const document of documents) {
    for (const chunk of await chunksOf(document)) {
      const usable = document.embedderId === embedder.id && chunk.vector
      ;(usable ? semantic : lexical).push({ chunk, document })
    }
  }

  const hits: RetrievedChunk[] = []
  if (semantic.length > 0) {
    try {
      const [vector] = await withTimeout(embedder.embed([query]), timeoutMs)
      for (const entry of semantic) {
        const score = cosine(vector!, entry.chunk.vector!)
        if (score >= embedder.threshold) hits.push({ ...entry, score, method: 'vector' })
      }
    } catch (error) {
      console.warn('TreeChat: query embedding failed, using keyword search', error)
      lexical.push(...semantic)
    }
  }
  if (lexical.length > 0) {
    const scores = bm25Scores(query, lexical.map((entry) => entry.chunk.text))
    lexical.forEach((entry, index) => {
      const score = scores[index]!
      if (score > 0) hits.push({ ...entry, score: keywordScore(score), method: 'keyword' })
    })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, k)
}

function label(hit: RetrievedChunk) {
  return hit.chunk.locator ? `${hit.document.name} — ${hit.chunk.locator}` : hit.document.name
}

/** The system section listing numbered excerpts; `[n]` matches citation `n`. */
export function documentsPrompt(hits: RetrievedChunk[]): string {
  const excerpts = hits.map((hit, index) => `[${index + 1}] ${label(hit)}\n"""\n${hit.chunk.text}\n"""`)
  return [
    'DOCUMENTS',
    'Excerpts from the user\'s own documents, retrieved for their latest message. ' +
      'Use them when they are relevant, and cite each excerpt you rely on with its ' +
      'marker right after the claim, e.g. [1] or [2][3]. Only cite the markers listed ' +
      'here. If the excerpts do not answer the question, say so instead of guessing.',
    ...excerpts,
  ].join('\n\n')
}

/** Citations whose ids are the excerpt numbers in `documentsPrompt`. */
export function documentCitations(hits: RetrievedChunk[]): Citation[] {
  return hits.map((hit, index) => {
    const citation: Citation = {
      id: String(index + 1),
      kind: 'document',
      title: hit.document.name,
      documentId: hit.document.id,
      snippet: hit.chunk.text,
    }
    if (hit.chunk.locator) citation.locator = hit.chunk.locator
    return citation
  })
}
