import { useState, type FormEvent } from 'react'
import { Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DEFAULT_OPENROUTER_MODEL,
  clearProviderConfig,
  loadProviderConfig,
  saveProviderConfig,
  type ClientProviderConfig,
} from '@/lib/provider'
import { cn } from '@/lib/utils'
import type { ProviderStatus } from '@/types'

const fieldClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

type SettingsDialogProps = {
  status: ProviderStatus
  onConfigChange: (config: ClientProviderConfig | null) => void
}

export function SettingsDialog({ status, onConfigChange }: SettingsDialogProps) {
  const [open, setOpen] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(DEFAULT_OPENROUTER_MODEL)
  const [saved, setSaved] = useState(false)

  const hydrate = () => {
    const current = loadProviderConfig()
    setApiKey(current?.apiKey ?? '')
    setModel(current?.model || DEFAULT_OPENROUTER_MODEL)
    setSaved(false)
  }

  const persist = (event: FormEvent) => {
    event.preventDefault()
    const nextKey = apiKey.trim()
    if (!nextKey) return
    const next: ClientProviderConfig = {
      provider: 'openrouter',
      apiKey: nextKey,
      model: model.trim() || DEFAULT_OPENROUTER_MODEL,
    }
    saveProviderConfig(next)
    onConfigChange(next)
    setModel(next.model)
    setSaved(true)
  }

  const clear = () => {
    clearProviderConfig()
    setApiKey('')
    setModel(DEFAULT_OPENROUTER_MODEL)
    setSaved(false)
    onConfigChange(null)
  }

  const modeLabel =
    status.mode === 'mock' ? 'mock' : status.provider === 'openrouter' ? 'openrouter' : status.provider

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) hydrate()
        setOpen(next)
      }}
    >
      <button
        type="button"
        onClick={() => {
          hydrate()
          setOpen(true)
        }}
        aria-label="Provider settings"
        title="Provider settings"
        data-testid="settings-button"
        className="flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <Settings className="size-3.5" />
      </button>
      <DialogContent className="max-w-md gap-5 sm:rounded-lg" data-testid="settings-dialog">
        <DialogHeader>
          <DialogTitle>Provider</DialogTitle>
          <DialogDescription>
            Paste an OpenRouter key to run live from this browser. It stays in
            this device's localStorage (treat it like a password) and is sent
            from the browser to OpenRouter on each chat request — never stored
            on TreeChat's host.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={persist} className="grid gap-4" autoComplete="off">
          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-secondary/40 px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Mode
            </span>
            <span
              data-testid="settings-mode"
              className={cn(
                'font-mono text-[11px] font-medium',
                status.mode === 'mock' ? 'text-muted-foreground' : 'text-branch-bright',
              )}
            >
              {modeLabel}
            </span>
          </div>
          <label className="grid gap-1.5">
            <span className="text-[12px] font-medium text-foreground">
              OpenRouter API key
            </span>
            <input
              type="password"
              name="openrouter-key"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value)
                setSaved(false)
              }}
              placeholder="sk-or-v1-…"
              autoComplete="off"
              spellCheck={false}
              data-testid="settings-api-key"
              className={fieldClass}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[12px] font-medium text-foreground">Model</span>
            <input
              type="text"
              name="openrouter-model"
              value={model}
              onChange={(event) => {
                setModel(event.target.value)
                setSaved(false)
              }}
              placeholder={DEFAULT_OPENROUTER_MODEL}
              spellCheck={false}
              data-testid="settings-model"
              className={fieldClass}
            />
          </label>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clear}
              data-testid="settings-clear"
            >
              Clear
            </Button>
            <div className="flex items-center gap-2">
              {saved ? (
                <span className="text-[11px] text-muted-foreground">Saved in this browser</span>
              ) : null}
              <Button
                type="submit"
                size="sm"
                disabled={!apiKey.trim()}
                data-testid="settings-save"
              >
                Save
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
