export const PROVIDER_STORAGE_KEY = 'treechat:provider:v1'
export const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4.1-mini'
export const TREECHAT_MODEL_HEADER = 'X-TreeChat-Model'

export type ClientProviderConfig = {
  provider: 'openrouter'
  apiKey: string
  model: string
}

export function parseProviderConfig(raw: string | null): ClientProviderConfig | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as Record<string, unknown>
    if (typeof record.apiKey !== 'string' || !record.apiKey.trim()) return null
    const model =
      typeof record.model === 'string' && record.model.trim()
        ? record.model.trim()
        : DEFAULT_OPENROUTER_MODEL
    return {
      provider: 'openrouter',
      apiKey: record.apiKey.trim(),
      model,
    }
  } catch {
    return null
  }
}

export function loadProviderConfig(): ClientProviderConfig | null {
  if (typeof localStorage === 'undefined') return null
  try {
    return parseProviderConfig(localStorage.getItem(PROVIDER_STORAGE_KEY))
  } catch {
    return null
  }
}

export function saveProviderConfig(config: ClientProviderConfig) {
  if (typeof localStorage === 'undefined') return
  const next: ClientProviderConfig = {
    provider: 'openrouter',
    apiKey: config.apiKey.trim(),
    model: config.model.trim() || DEFAULT_OPENROUTER_MODEL,
  }
  if (!next.apiKey) return
  localStorage.setItem(PROVIDER_STORAGE_KEY, JSON.stringify(next))
}

export function clearProviderConfig() {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(PROVIDER_STORAGE_KEY)
}

export function providerRequestHeaders(
  config: ClientProviderConfig | null = loadProviderConfig(),
): Record<string, string> {
  if (!config?.apiKey) return {}
  return {
    Authorization: `Bearer ${config.apiKey}`,
    [TREECHAT_MODEL_HEADER]: config.model || DEFAULT_OPENROUTER_MODEL,
  }
}
