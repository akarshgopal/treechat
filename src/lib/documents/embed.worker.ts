/// <reference lib="webworker" />
import { pipeline, type FeatureExtractionPipeline, type ProgressInfo } from '@huggingface/transformers'

/**
 * Runs the sentence-embedding model off the main thread. The model downloads
 * once from the Hugging Face hub and the browser caches it (Cache Storage);
 * the ONNX runtime's WASM comes from jsDelivr, which transformers.js
 * configures by default.
 */

export type WorkerRequest = { id: number; model: string; texts: string[] }
export type WorkerResponse =
  | { id: number; vectors: Float32Array[] }
  | { id: number; error: string }
  | { id: number; progress: { loaded: number; total: number } }

const scope = self as unknown as DedicatedWorkerGlobalScope
let extractor: Promise<FeatureExtractionPipeline> | null = null

function load(model: string, id: number) {
  if (!extractor) {
    extractor = pipeline('feature-extraction', model, {
      dtype: 'q8',
      progress_callback: (info: ProgressInfo) => {
        if (info.status === 'progress_total') {
          scope.postMessage({ id, progress: { loaded: info.loaded, total: info.total } } satisfies WorkerResponse)
        }
      },
    })
    // A failed load (offline) should be retried next time, not cached.
    extractor.catch(() => { extractor = null })
  }
  return extractor
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, model, texts } = event.data
  try {
    const run = await load(model, id)
    const output = await run(texts, { pooling: 'mean', normalize: true })
    const [rows, dims] = output.dims as [number, number]
    const data = output.data as Float32Array
    const vectors = Array.from({ length: rows }, (_, row) => data.slice(row * dims, (row + 1) * dims))
    scope.postMessage({ id, vectors } satisfies WorkerResponse, vectors.map((vector) => vector.buffer))
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) } satisfies WorkerResponse)
  }
}
