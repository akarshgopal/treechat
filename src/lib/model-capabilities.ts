/**
 * OpenRouter's public model list (no key needed): names, context sizes,
 * prices and whether a model reads images. Feeds the model picker, the
 * warning before a screenshot goes to a text-only model, and per-reply cost
 * labels. Unknown (list not loaded, fetch failed, model not listed) never
 * blocks anything.
 */

export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'
const CACHE_KEY = 'treechat:models:v3'
const CACHE_MS = 24 * 60 * 60 * 1000

export type ModelInfo = {
  id: string
  name: string
  /** Context window in tokens. */
  context?: number
  /** USD per input / output token. */
  prompt?: number
  completion?: number
  vision: boolean
  free: boolean
  /** When OpenRouter added it (Unix seconds); newest models list first. */
  created?: number
}

type Cache = { fetchedAt: number; models: ModelInfo[] }

let memory: { list: ModelInfo[]; byId: Map<string, ModelInfo> } | null = null
let loading: Promise<void> | null = null
/** The last fetch failed (offline, blocked); the next load tries again. */
let failed = false
const listeners = new Set<() => void>()
const notify = () => { for (const listener of listeners) listener() }

const price = (value: unknown): number | undefined => {
  const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

/**
 * Accepts both image-input shapes OpenRouter has used:
 * `architecture.input_modalities: ['text', 'image']` and
 * `architecture.modality: 'text+image->text'`.
 */
export function parseModelCatalog(payload: unknown): ModelInfo[] {
  const data = (payload as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []
  const out: ModelInfo[] = []
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as {
      id?: unknown
      name?: unknown
      created?: unknown
      context_length?: unknown
      pricing?: { prompt?: unknown; completion?: unknown }
      architecture?: { input_modalities?: unknown; modality?: unknown }
    }
    if (typeof record.id !== 'string' || !record.id) continue
    const inputs = record.architecture?.input_modalities
    const modality = record.architecture?.modality
    const prompt = price(record.pricing?.prompt)
    const completion = price(record.pricing?.completion)
    out.push({
      id: record.id,
      // "OpenAI: GPT-4.1 Mini" → "GPT-4.1 Mini"; the vendor is in the id.
      name: typeof record.name === 'string' && record.name.trim() ? record.name.replace(/^[^:]{1,40}:\s*/, '').trim() : record.id,
      ...(typeof record.context_length === 'number' ? { context: record.context_length } : {}),
      ...(prompt !== undefined ? { prompt } : {}),
      ...(completion !== undefined ? { completion } : {}),
      vision:
        (Array.isArray(inputs) && inputs.includes('image')) ||
        (typeof modality === 'string' && (modality.split('->')[0] ?? '').split('+').includes('image')),
      free: record.id.endsWith(':free') || (prompt === 0 && completion === 0),
      ...(typeof record.created === 'number' ? { created: record.created } : {}),
    })
  }
  return out
}

function remember(list: ModelInfo[]) {
  memory = { list, byId: new Map(list.map((model) => [model.id, model])) }
  failed = false
  notify()
}

function readCache(): Cache | null {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as Cache | null
    if (cached && Date.now() - cached.fetchedAt < CACHE_MS && Array.isArray(cached.models)) return cached
  } catch {
    // A broken cache is just a cache miss.
  }
  return null
}

/** Load the list once per day per browser; safe to call often. */
export function loadModelCapabilities(fetcher: typeof fetch = fetch): Promise<void> {
  if (memory) return Promise.resolve()
  const cached = readCache()
  if (cached) {
    remember(cached.models)
    return Promise.resolve()
  }
  if (!loading) {
    loading = fetcher(OPENROUTER_MODELS_URL)
      .then(async (response) => {
        if (!response.ok) throw new Error(`models ${response.status}`)
        const models = parseModelCatalog(await response.json())
        if (models.length === 0) return
        remember(models)
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), models } satisfies Cache))
        } catch {
          // Too big or blocked: keep it in memory for this visit.
        }
      })
      .catch(() => {
        failed = true
        notify()
      })
      .finally(() => { loading = null })
  }
  return loading
}

/** For `useSyncExternalStore`: the list once loaded, else null. */
export function subscribeModelCatalog(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export const modelCatalog = (): ModelInfo[] | null => memory?.list ?? null
export const modelCatalogFailed = () => failed

export function modelInfo(model: string): ModelInfo | undefined {
  return memory?.byId.get(model.trim())
}

/** `true` / `false` when OpenRouter lists the model, `undefined` when unknown. */
export function modelReadsImages(model: string): boolean | undefined {
  return modelInfo(model)?.vision
}

/** "$0.15" per million tokens, the way OpenRouter shows prices. */
export function perMillion(perToken: number | undefined): string {
  if (perToken === undefined) return '—'
  if (perToken === 0) return 'free'
  const value = perToken * 1_000_000
  return `$${value >= 10 ? value.toFixed(0) : value >= 0.1 ? value.toFixed(2) : value.toPrecision(2)}`
}

/** "128k", "1M" */
export function contextLabel(tokens: number | undefined): string {
  if (!tokens) return ''
  return tokens >= 1_000_000 ? `${+(tokens / 1_000_000).toFixed(1)}M` : `${Math.round(tokens / 1000)}k`
}
