export const PROVIDER_STORAGE_KEY = 'treechat:provider:v1'
export const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4.1-mini'
export const TREECHAT_MODEL_HEADER = 'X-TreeChat-Model'

export const OPENROUTER_MODEL_OPTIONS = [
  { id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' },
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'x-ai/grok-4', label: 'Grok 4' },
] as const

export type ClientProviderConfig = {
  provider: 'openrouter'
  apiKey: string
  model: string
  temperature?: number
  maxTokens?: number
}

export function defaultProviderConfig(): ClientProviderConfig {
  return {
    provider: 'openrouter',
    apiKey: '',
    model: DEFAULT_OPENROUTER_MODEL,
  }
}

export function parseTemperature(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : NaN
  if (!Number.isFinite(n)) return undefined
  return Math.round(Math.min(2, Math.max(0, n)) * 100) / 100
}

export function parseMaxTokens(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : NaN
  if (!Number.isFinite(n)) return undefined
  const tokens = Math.floor(n)
  return tokens >= 1 ? tokens : undefined
}

export function normalizeProviderConfig(
  config: Partial<ClientProviderConfig> | Record<string, unknown>,
): ClientProviderConfig {
  const record = config as Record<string, unknown>
  const apiKey = typeof record.apiKey === 'string' ? record.apiKey.trim() : ''
  const model =
    typeof record.model === 'string' && record.model.trim()
      ? record.model.trim()
      : DEFAULT_OPENROUTER_MODEL
  const temperature = parseTemperature(record.temperature)
  const maxTokens = parseMaxTokens(record.maxTokens)
  const next: ClientProviderConfig = {
    provider: 'openrouter',
    apiKey,
    model,
  }
  if (temperature !== undefined) next.temperature = temperature
  if (maxTokens !== undefined) next.maxTokens = maxTokens
  return next
}

export function parseProviderConfig(raw: string | null): ClientProviderConfig | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return normalizeProviderConfig(parsed as Record<string, unknown>)
  } catch {
    return null
  }
}

export function serializeProviderConfig(config: ClientProviderConfig): string {
  const next = normalizeProviderConfig(config)
  const payload: Record<string, unknown> = {
    provider: 'openrouter',
    apiKey: next.apiKey,
    model: next.model,
  }
  if (next.temperature !== undefined) payload.temperature = next.temperature
  if (next.maxTokens !== undefined) payload.maxTokens = next.maxTokens
  return JSON.stringify(payload)
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
  localStorage.setItem(PROVIDER_STORAGE_KEY, serializeProviderConfig(config))
}

export function patchProviderConfig(
  patch: Partial<ClientProviderConfig>,
): ClientProviderConfig {
  const current = loadProviderConfig() ?? defaultProviderConfig()
  const next = normalizeProviderConfig({ ...current, ...patch })
  saveProviderConfig(next)
  return next
}

export function clearProviderConfig() {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(PROVIDER_STORAGE_KEY)
}

export function hasClientApiKey(config: ClientProviderConfig | null): boolean {
  return Boolean(config?.apiKey)
}

export function shortModelName(model: string): string {
  const trimmed = model.trim()
  const slash = trimmed.lastIndexOf('/')
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed
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
