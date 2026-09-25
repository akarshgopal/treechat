import { useEffect, useState } from 'react'
import { RotateCw } from 'lucide-react'
import { fetchKeyUsage, type KeyUsage } from '@/lib/key-usage'

type Result = { request: string; usage?: KeyUsage; error?: string }

const dollars = (value: number) => `$${value.toFixed(value < 10 ? 2 : 0)}`

/** Credits this key has spent, and what its limit leaves, straight from OpenRouter. */
export function KeyUsagePanel({ apiKey }: { apiKey: string }) {
  const [refresh, setRefresh] = useState(0)
  const [result, setResult] = useState<Result | null>(null)
  const request = `${apiKey}:${refresh}`

  useEffect(() => {
    let live = true
    fetchKeyUsage(apiKey).then(
      (usage) => { if (live) setResult({ request, usage }) },
      (error: unknown) => { if (live) setResult({ request, error: error instanceof Error ? error.message : 'Could not load usage.' }) },
    )
    return () => { live = false }
  }, [apiKey, request])

  const current = result?.request === request ? result : null
  const usage = current?.usage
  return (
    <div className="flex items-start gap-2 rounded-md border border-border px-3 py-2 text-[11px] text-muted-foreground" data-testid="key-usage" aria-live="polite">
      <div className="grid min-w-0 flex-1 gap-0.5">
        {!current ? <span>Checking this key’s usage…</span> : null}
        {current?.error ? <span className="text-destructive">{current.error}</span> : null}
        {usage ? (
          <>
            <span className="text-xs text-foreground">
              {dollars(usage.usage)} spent
              {usage.limit !== null ? ` of ${dollars(usage.limit)}` : ''}
              {usage.remaining !== null ? ` · ${dollars(usage.remaining)} left` : ''}
            </span>
            {usage.daily !== undefined || usage.monthly !== undefined ? (
              <span>
                {[usage.daily !== undefined ? `today ${dollars(usage.daily)}` : '', usage.monthly !== undefined ? `this month ${dollars(usage.monthly)}` : ''].filter(Boolean).join(' · ')}
              </span>
            ) : null}
            {usage.limit === null ? (
              <span>
                This key has no credit limit.{' '}
                <a className="underline underline-offset-2 hover:text-foreground" href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener noreferrer">Set one on OpenRouter</a>.
              </span>
            ) : null}
          </>
        ) : null}
      </div>
      <button type="button" className="icon-button icon-button-sm -my-1 -mr-2" onClick={() => setRefresh((value) => value + 1)} aria-label="Refresh usage" title="Refresh usage">
        <RotateCw size={13} />
      </button>
    </div>
  )
}
