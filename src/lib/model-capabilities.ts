/**
 * Which OpenRouter models read images, from its public model list. Used to
 * warn before sending a screenshot to a text-only model. Unknown (list not
 * loaded, fetch failed, model not listed) never blocks anything.
 */

export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'
const CACHE_KEY = 'treechat:vision-models:v1'
const CACHE_MS = 24 * 60 * 60 * 1000

type Cache = { fetchedAt: number; vision: string[]; known: string[] }

let memory: { vision: Set<string>; known: Set<string> } | null = null
let loading: Promise<void> | null = null

/**
 * Model ids that accept image input. Accepts both shapes OpenRouter has used:
 * `architecture.input_modalities: ['text', 'image']` and
 * `architecture.modality: 'text+image->text'`.
 */
export function parseVisionModels(payload: unknown): { vision: string[]; known: string[] } {
  const data = (payload as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return { vision: [], known: [] }
  const vision: string[] = []
  const known: string[] = []
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as { id?: unknown; architecture?: { input_modalities?: unknown; modality?: unknown } }
    if (typeof record.id !== 'string') continue
    known.push(record.id)
    const inputs = record.architecture?.input_modalities
    const modality = record.architecture?.modality
    const reads =
      (Array.isArray(inputs) && inputs.includes('image')) ||
      (typeof modality === 'string' && (modality.split('->')[0] ?? '').split('+').includes('image'))
    if (reads) vision.push(record.id)
  }
  return { vision, known }
}

function readCache(): Cache | null {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as Cache | null
    if (cached && Date.now() - cached.fetchedAt < CACHE_MS && Array.isArray(cached.vision) && Array.isArray(cached.known)) return cached
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
    memory = { vision: new Set(cached.vision), known: new Set(cached.known) }
    return Promise.resolve()
  }
  if (!loading) {
    loading = fetcher(OPENROUTER_MODELS_URL)
      .then(async (response) => {
        if (!response.ok) throw new Error(`models ${response.status}`)
        const { vision, known } = parseVisionModels(await response.json())
        if (known.length === 0) return
        memory = { vision: new Set(vision), known: new Set(known) }
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), vision, known } satisfies Cache))
        } catch {
          // Too big or blocked: keep it in memory for this visit.
        }
      })
      .catch(() => undefined)
      .finally(() => { loading = null })
  }
  return loading
}

/** `true` / `false` when OpenRouter lists the model, `undefined` when unknown. */
export function modelReadsImages(model: string): boolean | undefined {
  if (!memory) return undefined
  const id = model.trim()
  if (!memory.known.has(id)) return undefined
  return memory.vision.has(id)
}

/** Tests: forget what was loaded. */
export function resetModelCapabilities() {
  memory = null
  loading = null
}
