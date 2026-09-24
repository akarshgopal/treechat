export const PROVIDER_STORAGE_KEY = 'treechat:provider:v1'
export const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4.1-mini'
export const TREECHAT_MODEL_HEADER = 'X-TreeChat-Model'

export const OPENROUTER_MODEL_OPTIONS = [
  { id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' },
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'x-ai/grok-4.6', label: 'Grok 4.6' },
] as const

/**
 * Cheap presets for background work. `:free` ids cost nothing but may log
 * prompts and are tightly rate limited, so failures fall back to the main model.
 */
export const BACKGROUND_MODEL_OPTIONS = [
  { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B (free)' },
  { id: 'openai/gpt-4.1-nano', label: 'GPT-4.1 Nano' },
  { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
] as const

export type ClientProviderConfig = {
  provider: 'openrouter'
  apiKey: string
  model: string
  temperature?: number
  maxTokens?: number
  /** Used for summaries and takeaway drafts. Unset means the main model. */
  backgroundModel?: string
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
  const backgroundModel =
    typeof record.backgroundModel === 'string' && isModelId(record.backgroundModel)
      ? record.backgroundModel.trim()
      : undefined
  const next: ClientProviderConfig = {
    provider: 'openrouter',
    apiKey,
    model,
  }
  if (temperature !== undefined) next.temperature = temperature
  if (maxTokens !== undefined) next.maxTokens = maxTokens
  if (backgroundModel !== undefined) next.backgroundModel = backgroundModel
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
  if (next.backgroundModel !== undefined) payload.backgroundModel = next.backgroundModel
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

/**
 * OpenRouter ids are `vendor/model`, optionally with a `:variant` suffix.
 * Catches half-typed text before it is saved and sent with every request.
 */
export function isModelId(value: string): boolean {
  return /^[\w.-]+\/[\w.:@-]+$/.test(value.trim())
}

/**
 * The model to try first for background work, when it differs from the main
 * one. Needs a key: without one requests go to the local API or the mock.
 */
export function backgroundModelFor(config: ClientProviderConfig | null): string | undefined {
  if (!config?.apiKey || !config.backgroundModel) return undefined
  return config.backgroundModel === config.model ? undefined : config.backgroundModel
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
