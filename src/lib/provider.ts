const PROVIDER_STORAGE_KEY = 'treechat:provider:v1'
export const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-5.6-luna'

export const OPENROUTER_MODEL_OPTIONS = [
  { id: 'openai/gpt-5.6-luna', label: 'GPT-5.6 Luna' },
  { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
  { id: 'x-ai/grok-4.7', label: 'Grok 4.7' },
] as const

/**
 * Cheap presets for background work. `:free` ids cost nothing but may log
 * prompts and are tightly rate limited, so failures fall back to the main model.
 */
export const BACKGROUND_MODEL_OPTIONS = [
  { id: 'qwen/qwen3.8-27b:free', label: 'Qwen3.8 27B (free)' },
  { id: 'qwen/qwen3.7-flash', label: 'Qwen3.7 Flash' },
  { id: 'google/gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
] as const

/**
 * `openrouter` is the built-in provider (model catalog, prices, web search,
 * key usage). `openai-compatible` is any server that speaks OpenAI's
 * `/chat/completions`: a hosted API (OpenAI, Groq, …) or the user's own
 * (Ollama, LM Studio, vLLM, a gateway), reached at `baseUrl`.
 */
export type ProviderKind = 'openrouter' | 'openai-compatible'

export type ClientProviderConfig = {
  provider: ProviderKind
  apiKey: string
  model: string
  /** openai-compatible only: the API root, e.g. `https://api.openai.com/v1`. */
  baseUrl?: string
  /** openai-compatible only: sent with every request, after the defaults. */
  headers?: Record<string, string>
  /** openai-compatible only: merged into the request body (e.g. `reasoning_effort`). */
  extraBody?: Record<string, unknown>
  temperature?: number
  maxTokens?: number
  /** Used for summaries and takeaway drafts. Unset means the main model. */
  backgroundModel?: string
}

/** Starting points for the provider list; each is the generic adapter with a URL filled in. */
export type ProviderPreset = {
  id: string
  label: string
  baseUrl: string
  /** Suggested when picking a model; the field accepts any id. */
  models: readonly { id: string; label: string }[]
  /** Local servers usually need no key. */
  keyOptional?: boolean
  keyPlaceholder?: string
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    keyPlaceholder: 'sk-…',
    models: [
      { id: 'gpt-4.1', label: 'GPT-4.1' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
    ],
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyPlaceholder: 'gsk_…',
    models: [{ id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' }],
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    keyOptional: true,
    models: [{ id: 'llama3.2', label: 'Llama 3.2' }],
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    baseUrl: 'http://localhost:1234/v1',
    keyOptional: true,
    models: [],
  },
]

export function isOpenRouter(config: Pick<ClientProviderConfig, 'provider'> | null | undefined): boolean {
  return !config || config.provider === 'openrouter'
}

/**
 * Whether replies come from a real provider. OpenRouter needs a key; a custom
 * server needs a URL (its key is optional). Otherwise replies are the demo.
 */
export function isLiveConfig(config: ClientProviderConfig | null | undefined): config is ClientProviderConfig {
  if (!config) return false
  if (config.provider === 'openrouter') return Boolean(config.apiKey)
  return Boolean(config.baseUrl)
}

/**
 * A base URL as it is stored: http(s) only, no trailing slash, no fragment.
 * The query string stays (gateways such as Azure need `?api-version=…`).
 * `undefined` for anything else. A full `…/chat/completions` URL is kept as
 * typed, for servers with a non-standard path.
 */
export function parseBaseUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (url.username || url.password) return undefined
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}${url.search}`
  } catch {
    return undefined
  }
}

/** Where chat requests go for an openai-compatible config. */
export function chatCompletionsUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  if (!/\/chat\/completions$/.test(url.pathname)) url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`
  return url.toString()
}

/** Where a saved key and headers are sent: two URLs on one origin share them. */
export function baseUrlOrigin(baseUrl: string | undefined): string | undefined {
  try {
    return baseUrl ? new URL(baseUrl).origin : undefined
  } catch {
    return undefined
  }
}

/** "localhost:11434", "api.openai.com": what to call the server in messages. */
export function providerName(config: Pick<ClientProviderConfig, 'provider' | 'baseUrl'> | null | undefined): string {
  if (isOpenRouter(config)) return 'OpenRouter'
  try {
    return new URL(config?.baseUrl ?? '').host || 'the server'
  } catch {
    return 'the server'
  }
}

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

/** "Name: value" lines to headers; blank lines are skipped. `undefined` when a line is malformed. */
export function parseHeaderLines(text: string): Record<string, string> | undefined {
  const headers: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const colon = line.indexOf(':')
    const name = colon > 0 ? line.slice(0, colon).trim() : ''
    const value = colon > 0 ? line.slice(colon + 1).trim() : ''
    if (!HEADER_NAME.test(name) || !value || /[\r\n]/.test(value)) return undefined
    headers[name] = value
  }
  return headers
}

export function formatHeaderLines(headers: Record<string, string> | undefined): string {
  return Object.entries(headers ?? {}).map(([name, value]) => `${name}: ${value}`).join('\n')
}

/** A JSON object typed by hand; blank means none. `undefined` when it is not an object. */
export function parseExtraBody(text: string): Record<string, unknown> | null | undefined {
  if (!text.trim()) return null
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

function headersFrom(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, string> = {}
  for (const [name, entry] of Object.entries(value)) {
    if (HEADER_NAME.test(name) && typeof entry === 'string' && entry.trim() && !/[\r\n]/.test(entry)) {
      out[name] = entry.trim()
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function extraBodyFrom(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return Object.keys(value).length > 0 ? (value as Record<string, unknown>) : undefined
}

function defaultProviderConfig(): ClientProviderConfig {
  return {
    provider: 'openrouter',
    apiKey: '',
    model: DEFAULT_OPENROUTER_MODEL,
  }
}

function parseTemperature(value: unknown): number | undefined {
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

function parseMaxTokens(value: unknown): number | undefined {
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
  const provider: ProviderKind = record.provider === 'openai-compatible' ? 'openai-compatible' : 'openrouter'
  const model =
    typeof record.model === 'string' && record.model.trim()
      ? record.model.trim()
      : provider === 'openrouter'
        ? DEFAULT_OPENROUTER_MODEL
        : ''
  const temperature = parseTemperature(record.temperature)
  const maxTokens = parseMaxTokens(record.maxTokens)
  const backgroundModel =
    typeof record.backgroundModel === 'string' && isModelIdFor(provider, record.backgroundModel)
      ? record.backgroundModel.trim()
      : undefined
  const next: ClientProviderConfig = {
    provider,
    apiKey,
    model,
  }
  if (provider === 'openai-compatible') {
    const baseUrl = parseBaseUrl(record.baseUrl)
    const headers = headersFrom(record.headers)
    const extraBody = extraBodyFrom(record.extraBody)
    if (baseUrl !== undefined) next.baseUrl = baseUrl
    if (headers !== undefined) next.headers = headers
    if (extraBody !== undefined) next.extraBody = extraBody
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
    provider: next.provider,
    apiKey: next.apiKey,
    model: next.model,
  }
  if (next.baseUrl !== undefined) payload.baseUrl = next.baseUrl
  if (next.headers !== undefined) payload.headers = next.headers
  if (next.extraBody !== undefined) payload.extraBody = next.extraBody
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

/**
 * OpenRouter ids are `vendor/model`, optionally with a `:variant` suffix.
 * Catches half-typed text before it is saved and sent with every request.
 */
export function isModelId(value: string): boolean {
  return /^[\w.-]+\/[\w.:@-]+$/.test(value.trim())
}

/** Custom servers name models however they like (`gpt-4.1`, `llama3.2:3b`, `org/model`); only whitespace is ruled out. */
export function isModelIdFor(provider: ProviderKind | undefined, value: string): boolean {
  const trimmed = value.trim()
  return provider === 'openai-compatible' ? trimmed !== '' && !/\s/.test(trimmed) : isModelId(trimmed)
}

/** The models to suggest for a provider's config; the picker accepts any id besides. */
export function modelSuggestions(config: ClientProviderConfig | null | undefined): readonly { id: string; label: string }[] {
  if (isOpenRouter(config)) return OPENROUTER_MODEL_OPTIONS
  const preset = PROVIDER_PRESETS.find((entry) => entry.baseUrl === config?.baseUrl)
  return preset?.models ?? []
}

/**
 * The model to try first for background work, when it differs from the main
 * one. Needs a key: without one, replies come from the in-page demo.
 */
export function backgroundModelFor(config: ClientProviderConfig | null): string | undefined {
  if (!isLiveConfig(config) || !config.backgroundModel) return undefined
  return config.backgroundModel === config.model ? undefined : config.backgroundModel
}

export function shortModelName(model: string): string {
  const trimmed = model.trim()
  const slash = trimmed.lastIndexOf('/')
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed
}
