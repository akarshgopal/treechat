/**
 * What an OpenRouter key has spent, from OpenRouter itself. Sent only to
 * OpenRouter, with the key, when Settings opens.
 */

export const KEY_URL = 'https://openrouter.ai/api/v1/key'
const LEGACY_KEY_URL = 'https://openrouter.ai/api/v1/auth/key'

export type KeyUsage = {
  /** USD spent so far. */
  usage: number
  /** The key's credit limit in USD; null when it has none. */
  limit: number | null
  remaining: number | null
  daily?: number
  monthly?: number
  freeTier: boolean
}

const money = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

export function parseKeyUsage(payload: unknown): KeyUsage | null {
  const data = (payload as { data?: Record<string, unknown> } | null)?.data
  if (!data || typeof data !== 'object') return null
  const usage = money(data.usage)
  if (usage === undefined) return null
  const daily = money(data.usage_daily)
  const monthly = money(data.usage_monthly)
  return {
    usage,
    limit: money(data.limit) ?? null,
    remaining: money(data.limit_remaining) ?? null,
    ...(daily !== undefined ? { daily } : {}),
    ...(monthly !== undefined ? { monthly } : {}),
    freeTier: data.is_free_tier === true,
  }
}

export async function fetchKeyUsage(apiKey: string, fetcher: typeof fetch = fetch): Promise<KeyUsage> {
  const headers = { Authorization: `Bearer ${apiKey}` }
  const get = (url: string) => fetcher(url, { headers }).catch(() => {
    throw new Error('Could not reach OpenRouter to check usage.')
  })
  let response = await get(KEY_URL)
  // Older deployments only answer on the /auth path.
  if (response.status === 404) response = await get(LEGACY_KEY_URL)
  if (response.status === 401 || response.status === 403) throw new Error('OpenRouter did not accept this key.')
  if (!response.ok) throw new Error(`OpenRouter could not report usage (${response.status}).`)
  const parsed = parseKeyUsage(await response.json())
  if (!parsed) throw new Error('OpenRouter sent usage in an unexpected shape.')
  return parsed
}
