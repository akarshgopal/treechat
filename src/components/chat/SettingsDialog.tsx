import { useState, type FormEvent } from 'react'
import { Settings } from 'lucide-react'
import { ModelPicker, ModelPresetChips } from '@/components/chat/ModelPicker'
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
  normalizeProviderConfig,
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
  onRestoreDemo: () => void
}

export function SettingsDialog({
  status,
  onConfigChange,
  onRestoreDemo,
}: SettingsDialogProps) {
  const [open, setOpen] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(DEFAULT_OPENROUTER_MODEL)
  const [temperature, setTemperature] = useState('')
  const [maxTokens, setMaxTokens] = useState('')
  const [saved, setSaved] = useState(false)

  const hydrate = () => {
    const current = loadProviderConfig()
    setApiKey(current?.apiKey ?? '')
    setModel(current?.model || DEFAULT_OPENROUTER_MODEL)
    setTemperature(
      current?.temperature !== undefined ? String(current.temperature) : '',
    )
    setMaxTokens(current?.maxTokens !== undefined ? String(current.maxTokens) : '')
    setSaved(false)
  }

  const persist = (event: FormEvent) => {
    event.preventDefault()
    const next = normalizeProviderConfig({
      apiKey,
      model,
      temperature: temperature.trim() === '' ? undefined : temperature,
      maxTokens: maxTokens.trim() === '' ? undefined : maxTokens,
    })
    saveProviderConfig(next)
    onConfigChange(next)
    setApiKey(next.apiKey)
    setModel(next.model)
    setTemperature(next.temperature !== undefined ? String(next.temperature) : '')
    setMaxTokens(next.maxTokens !== undefined ? String(next.maxTokens) : '')
    setSaved(true)
  }

  const clear = () => {
    clearProviderConfig()
    setApiKey('')
    setModel(DEFAULT_OPENROUTER_MODEL)
    setTemperature('')
    setMaxTokens('')
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
            Paste an OpenRouter key to run live from this browser. Model and
            generation params are saved even without a key — chat stays mock
            until you add one. The key stays in this device's localStorage
            (treat it like a password) and is sent from the browser to
            OpenRouter on each chat request — never stored on TreeChat's host.
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
          <div className="grid gap-1.5">
            <ModelPicker
              id="settings-model"
              name="openrouter-model"
              value={model}
              onChange={(next) => {
                setModel(next)
                setSaved(false)
              }}
            />
            <ModelPresetChips
              value={model}
              onSelect={(next) => {
                setModel(next)
                setSaved(false)
              }}
            />
            <p className="text-[11px] text-muted-foreground">
              Pick a preset or paste any OpenRouter model id.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1.5">
              <span className="text-[12px] font-medium text-foreground">
                Temperature
              </span>
              <input
                type="number"
                name="openrouter-temperature"
                min={0}
                max={2}
                step={0.1}
                value={temperature}
                onChange={(event) => {
                  setTemperature(event.target.value)
                  setSaved(false)
                }}
                placeholder="default"
                data-testid="settings-temperature"
                className={fieldClass}
              />
              <span className="text-[11px] text-muted-foreground">Optional · 0–2</span>
            </label>
            <label className="grid gap-1.5">
              <span className="text-[12px] font-medium text-foreground">
                Max tokens
              </span>
              <input
                type="number"
                name="openrouter-max-tokens"
                min={1}
                step={1}
                value={maxTokens}
                onChange={(event) => {
                  setMaxTokens(event.target.value)
                  setSaved(false)
                }}
                placeholder="default"
                data-testid="settings-max-tokens"
                className={fieldClass}
              />
              <span className="text-[11px] text-muted-foreground">Optional</span>
            </label>
          </div>
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
              <Button type="submit" size="sm" data-testid="settings-save">
                Save
              </Button>
            </div>
          </DialogFooter>
        </form>
        <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
          <div className="grid gap-0.5">
            <span className="text-[12px] font-medium text-foreground">Demo conversation</span>
            <span className="text-[11px] text-muted-foreground">
              Load the seeded “What is TreeChat?” walkthrough.
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              onRestoreDemo()
              setOpen(false)
            }}
            data-testid="settings-restore-demo"
          >
            Restore demo
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
