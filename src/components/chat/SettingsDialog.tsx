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
  isModelId,
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
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfigChange: (config: ClientProviderConfig | null) => void
  onRestoreDemo: () => void
}

export function SettingsDialog({
  status,
  open,
  onOpenChange,
  onConfigChange,
  onRestoreDemo,
}: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        aria-label="Settings"
        title="Settings"
        data-testid="settings-button"
        className="flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <Settings className="size-3.5" />
      </button>
      <DialogContent className="max-h-[90svh] max-w-md gap-5 overflow-y-auto sm:rounded-lg" data-testid="settings-dialog">
        {/* Content unmounts while closed, so each open re-reads storage: the
            header model picker or another tab may have changed it. */}
        <SettingsBody
          status={status}
          onConfigChange={onConfigChange}
          onRestoreDemo={() => {
            onRestoreDemo()
            onOpenChange(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function SettingsBody({
  status,
  onConfigChange,
  onRestoreDemo,
}: Pick<SettingsDialogProps, 'status' | 'onConfigChange' | 'onRestoreDemo'>) {
  const [initial] = useState(() => loadProviderConfig())
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? '')
  const [model, setModel] = useState(initial?.model || DEFAULT_OPENROUTER_MODEL)
  const [temperature, setTemperature] = useState(
    initial?.temperature !== undefined ? String(initial.temperature) : '',
  )
  const [maxTokens, setMaxTokens] = useState(
    initial?.maxTokens !== undefined ? String(initial.maxTokens) : '',
  )
  const [saved, setSaved] = useState(false)
  const [savedModel, setSavedModel] = useState(initial?.model || DEFAULT_OPENROUTER_MODEL)
  const [hasKey, setHasKey] = useState(Boolean(initial?.apiKey))
  const modelValid = isModelId(model)

  const persist = (event: FormEvent) => {
    event.preventDefault()
    if (!modelValid) return
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
    setSavedModel(next.model)
    setHasKey(Boolean(next.apiKey))
    setSaved(true)
  }

  /** Forget the key only; model and generation params stay as saved. */
  const removeKey = () => {
    const next = normalizeProviderConfig({ ...(loadProviderConfig() ?? {}), apiKey: '' })
    saveProviderConfig(next)
    setApiKey('')
    setHasKey(false)
    setSaved(false)
    onConfigChange(next)
  }

  const modeLabel =
    status.mode === 'mock' ? 'mock' : status.provider === 'openrouter' ? 'openrouter' : status.provider

  return (
    <>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Add an OpenRouter key for real answers. Without one, TreeChat
            replies with demo text so you can try branching.
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
            <span className="text-[11px] text-muted-foreground">
              Kept only in this browser and sent straight to OpenRouter. Treat it like a password.
            </span>
          </label>
          <div className="grid gap-1.5">
            <ModelPicker
              id="settings-model"
              name="openrouter-model"
              invalid={!modelValid}
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
            {modelValid ? (
              <p className="text-[11px] text-muted-foreground">
                Pick a preset or paste any OpenRouter model id.
              </p>
            ) : (
              <p className="text-[11px] text-destructive" role="alert" data-testid="settings-model-error">
                Model ids look like <span className="font-mono">vendor/model</span>, e.g. {savedModel}.
              </p>
            )}
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
            {hasKey ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={removeKey}
                data-testid="settings-clear"
              >
                Remove key
              </Button>
            ) : <span />}
            <div className="flex items-center gap-2">
              {saved ? (
                <span className="text-[11px] text-muted-foreground">Saved in this browser</span>
              ) : null}
              <Button type="submit" size="sm" data-testid="settings-save" disabled={!modelValid}>
                Save
              </Button>
            </div>
          </DialogFooter>
        </form>
        <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
          <div className="grid gap-0.5">
            <span className="text-[12px] font-medium text-foreground">Demo conversation</span>
            <span className="text-[11px] text-muted-foreground">
              Replace this chat with the “What is TreeChat?” walkthrough.
              Other chats are left alone.
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRestoreDemo}
            data-testid="settings-restore-demo"
          >
            Restore demo
          </Button>
        </div>
    </>
  )
}
