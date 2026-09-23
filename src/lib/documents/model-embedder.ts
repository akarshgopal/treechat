import type { EmbedProgress, Embedder } from './embedder.ts'
import type { WorkerRequest, WorkerResponse } from './embed.worker.ts'

export const DEFAULT_EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2'
/** Rough size of the quantized model, shown before the first download. */
export const DEFAULT_EMBEDDING_MODEL_MB = 23

type Pending = {
  resolve: (vectors: Float32Array[]) => void
  reject: (error: Error) => void
  onProgress?: (progress: EmbedProgress) => void
}

/**
 * The real embedder: all-MiniLM-L6-v2 (quantized) in a Web Worker. The worker
 * and transformers.js load only when something is first embedded.
 */
export function createModelEmbedder(model = DEFAULT_EMBEDDING_MODEL): Embedder {
  let worker: Worker | null = null
  let nextId = 0
  const pending = new Map<number, Pending>()

  const failAll = (message: string) => {
    for (const entry of pending.values()) entry.reject(new Error(message))
    pending.clear()
    worker?.terminate()
    worker = null
  }

  const start = () => {
    if (worker) return worker
    worker = new Worker(new URL('./embed.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      const entry = pending.get(message.id)
      if (!entry) return
      if ('progress' in message) {
        entry.onProgress?.({ phase: 'download', ...message.progress })
        return
      }
      pending.delete(message.id)
      if ('error' in message) entry.reject(new Error(message.error))
      else {
        entry.onProgress?.({ phase: 'ready' })
        entry.resolve(message.vectors)
      }
    }
    worker.onerror = (event) => failAll(event.message || 'The embedding worker stopped.')
    return worker
  }

  return {
    id: `${model}#q8`,
    // Measured on short notes: matches scored 0.30–0.53, unrelated
    // passages up to ~0.21.
    threshold: 0.25,
    embed(texts, onProgress) {
      if (texts.length === 0) return Promise.resolve([])
      return new Promise((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve, reject, onProgress })
        start().postMessage({ id, model, texts } satisfies WorkerRequest)
      })
    },
  }
}
