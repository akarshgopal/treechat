import { chunkBlocks } from './chunk.ts'
import type { Embedder, EmbedProgress } from './embedder.ts'
import { extractFile, formatOf } from './extract.ts'
import { putDocument, saveIndexedDocument } from './store.ts'
import type { StoredDocument } from './types.ts'

export type IndexProgress =
  | { stage: 'reading' }
  /** First use only: the embedding model is downloading. */
  | { stage: 'model'; loaded?: number; total?: number }
  | { stage: 'embedding'; done: number; total: number }

const BATCH = 16

/**
 * Read, chunk, embed, and store one file. Resolves with the stored record,
 * which is `error` when the file could not be read. When only the embedding
 * model fails, the document is still stored (without vectors) so keyword
 * search can use it.
 */
export async function indexFile(
  file: Blob & { name: string },
  { id, embedder, onProgress }: { id: string; embedder: Embedder; onProgress?: (progress: IndexProgress) => void },
): Promise<StoredDocument> {
  const format = formatOf(file.name, file.type) ?? 'text'
  let doc: StoredDocument = {
    id,
    name: file.name,
    format,
    size: file.size,
    createdAt: Date.now(),
    status: 'indexing',
    chunkCount: 0,
  }
  await putDocument(doc)
  onProgress?.({ stage: 'reading' })

  let chunks
  try {
    const extracted = await extractFile(file)
    if (extracted.pages !== undefined) doc = { ...doc, pages: extracted.pages }
    chunks = chunkBlocks(id, extracted.blocks)
    if (chunks.length === 0) throw new Error(format === 'pdf' ? 'No text found — scanned PDFs are not supported.' : 'The file is empty.')
  } catch (error) {
    doc = { ...doc, status: 'error', error: error instanceof Error ? error.message : 'Could not read this file.' }
    await putDocument(doc)
    return doc
  }

  try {
    const onModel = (progress: EmbedProgress) => {
      if (progress.phase === 'download') onProgress?.({ stage: 'model', loaded: progress.loaded, total: progress.total })
    }
    for (let start = 0; start < chunks.length; start += BATCH) {
      onProgress?.({ stage: 'embedding', done: start, total: chunks.length })
      const batch = chunks.slice(start, start + BATCH)
      const vectors = await embedder.embed(batch.map((chunk) => chunk.text), onModel)
      batch.forEach((chunk, index) => { chunk.vector = vectors[index] })
    }
    onProgress?.({ stage: 'embedding', done: chunks.length, total: chunks.length })
    doc = { ...doc, status: 'ready', embedderId: embedder.id, chunkCount: chunks.length }
  } catch (error) {
    console.warn('TreeChat: embedding failed, falling back to keyword search', error)
    for (const chunk of chunks) delete chunk.vector
    doc = {
      ...doc,
      status: 'ready',
      chunkCount: chunks.length,
      error: `Keyword search only — the embedding model could not load (${error instanceof Error ? error.message : 'unknown error'}).`,
    }
  }
  await saveIndexedDocument(doc, chunks)
  return doc
}
