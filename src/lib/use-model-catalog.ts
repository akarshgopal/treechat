import { useSyncExternalStore } from 'react'
import { modelCatalog, subscribeModelCatalog } from './model-capabilities.ts'

/** OpenRouter's model list once loaded (see `loadModelCapabilities`), else null. */
export function useModelCatalog() {
  return useSyncExternalStore(subscribeModelCatalog, modelCatalog)
}
