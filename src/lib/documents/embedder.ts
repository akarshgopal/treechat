import { tokenize } from './keyword.ts'

export type EmbedProgress = {
  /** One-time model download, in bytes when the browser reports them. */
  phase: 'download' | 'ready'
  loaded?: number
  total?: number
}

/**
 * Turns text into unit vectors. Documents and queries must go through the
 * same embedder: `id` is stored with each document so a model change is
 * noticed instead of comparing incompatible vectors.
 */
export interface Embedder {
  id: string
  /** Cosine similarity below this is noise for this model. */
  threshold: number
  embed(texts: string[], onProgress?: (progress: EmbedProgress) => void): Promise<Float32Array[]>
}

const FAKE_DIMS = 256

function hash(token: string) {
  // FNV-1a: stable across runs and machines, which is all a fake needs.
  let value = 0x811c9dc5
  for (let index = 0; index < token.length; index += 1) {
    value ^= token.charCodeAt(index)
    value = Math.imul(value, 0x01000193)
  }
  return value >>> 0
}

export function normalizeVector(vector: Float32Array) {
  let norm = 0
  for (const value of vector) norm += value * value
  norm = Math.sqrt(norm)
  if (norm > 0) for (let index = 0; index < vector.length; index += 1) vector[index]! /= norm
  return vector
}

/**
 * Deterministic hashed bag-of-words. Used by unit and e2e tests (no model
 * download) and never by default; texts that share words score higher.
 */
export const fakeEmbedder: Embedder = {
  id: 'fake-bow-256',
  threshold: 0.1,
  async embed(texts) {
    return texts.map((text) => {
      const vector = new Float32Array(FAKE_DIMS)
      for (const token of tokenize(text)) vector[hash(token) % FAKE_DIMS]! += 1
      return normalizeVector(vector)
    })
  },
}

/** Dot product of unit vectors. */
export function cosine(a: Float32Array, b: Float32Array) {
  if (a.length !== b.length) return 0
  let sum = 0
  for (let index = 0; index < a.length; index += 1) sum += a[index]! * b[index]!
  return sum
}
