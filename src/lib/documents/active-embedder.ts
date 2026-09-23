import { fakeEmbedder, type Embedder } from './embedder.ts'
import { createModelEmbedder } from './model-embedder.ts'

/**
 * Set `localStorage['treechat:fake-embedder'] = '1'` before the app loads to
 * use the deterministic bag-of-words embedder instead of downloading the
 * model. E2E tests do this with `page.addInitScript`; it is read once.
 */
export const FAKE_EMBEDDER_KEY = 'treechat:fake-embedder'

let current: Embedder | null = null

function wantsFake() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(FAKE_EMBEDDER_KEY) === '1'
  } catch {
    return false
  }
}

export function getEmbedder(): Embedder {
  if (!current) current = wantsFake() || typeof Worker === 'undefined' ? fakeEmbedder : createModelEmbedder()
  return current
}

/** Tests swap in their own embedder (or a failing one). */
export function setEmbedder(embedder: Embedder | null) {
  current = embedder
}
