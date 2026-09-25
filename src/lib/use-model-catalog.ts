import { useSyncExternalStore } from 'react'
import { modelCatalog, modelCatalogFailed, subscribeModelCatalog } from './model-capabilities.ts'

/** OpenRouter's model list once loaded (see `loadModelCapabilities`), else null. */
export function useModelCatalog() {
  return useSyncExternalStore(subscribeModelCatalog, modelCatalog)
}

/** Whether the last attempt to load the list failed. */
export function useModelCatalogFailed() {
  return useSyncExternalStore(subscribeModelCatalog, modelCatalogFailed)
}
