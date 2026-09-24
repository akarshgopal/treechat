import { useState, type FormEvent } from 'react'
import { ModelPicker, ModelPresetChips } from '@/components/chat/ModelPicker'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  BACKGROUND_MODEL_OPTIONS,
  DEFAULT_OPENROUTER_MODEL,
  isModelId,
  loadProviderConfig,
  normalizeProviderConfig,
  saveProviderConfig,
  type ClientProviderConfig,
} from '@/lib/provider'

const fieldClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

type SettingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfigChange: (config: ClientProviderConfig | null) => void
  onRestoreDemo: () => void
}

export function SettingsDialog({
  open,
  onOpenChange,
  onConfigChange,
  onRestoreDemo,
}: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] max-w-md gap-5 overflow-y-auto sm:rounded-lg" data-testid="settings-dialog">
        {/* Content unmounts while closed, so each open re-reads storage: the
            header model picker or another tab may have changed it. */}
        <SettingsBody
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
  onConfigChange,
  onRestoreDemo,
}: Pick<SettingsDialogProps, 'onConfigChange' | 'onRestoreDemo'>) {
  const [initial] = useState(() => loadProviderConfig())
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? '')
  const [model, setModel] = useState(initial?.model || DEFAULT_OPENROUTER_MODEL)
  const [temperature, setTemperature] = useState(
    initial?.temperature !== undefined ? String(initial.temperature) : '',
  )
  const [maxTokens, setMaxTokens] = useState(
    initial?.maxTokens !== undefined ? String(initial.maxTokens) : '',
  )
  const [backgroundModel, setBackgroundModel] = useState(initial?.backgroundModel ?? '')
  const [saved, setSaved] = useState(false)
  const [savedModel, setSavedModel] = useState(initial?.model || DEFAULT_OPENROUTER_MODEL)
  const [hasKey, setHasKey] = useState(Boolean(initial?.apiKey))
  const modelValid = isModelId(model)
  const backgroundValid = !backgroundModel.trim() || isModelId(backgroundModel)

  const persist = (event: FormEvent) => {
    event.preventDefault()
    if (!modelValid || !backgroundValid) return
    const next = normalizeProviderConfig({
      apiKey,
      model,
      backgroundModel,
      temperature: temperature.trim() === '' ? undefined : temperature,
      maxTokens: maxTokens.trim() === '' ? undefined : maxTokens,
    })
    saveProviderConfig(next)
    onConfigChange(next)
    setApiKey(next.apiKey)
    setModel(next.model)
    setTemperature(next.temperature !== undefined ? String(next.temperature) : '')
    setMaxTokens(next.maxTokens !== undefined ? String(next.maxTokens) : '')
    setBackgroundModel(next.backgroundModel ?? '')
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
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">
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
          <details className="group rounded-lg border border-border" open={Boolean(initial?.backgroundModel || initial?.temperature !== undefined || initial?.maxTokens !== undefined) || undefined}>
            <summary className="flex h-9 cursor-pointer list-none items-center justify-between rounded-lg px-3 text-[13px] text-muted-foreground hover:text-foreground">
              Advanced
              <span className="text-xs transition-transform group-open:rotate-90" aria-hidden>›</span>
            </summary>
            <div className="grid gap-4 border-t border-border p-3">
          <div className="grid gap-1.5">
            <label htmlFor="settings-background-model" className="text-xs font-medium text-foreground">
              Background model
            </label>
            <input
              id="settings-background-model"
              name="openrouter-background-model"
              value={backgroundModel}
              onChange={(event) => {
                setBackgroundModel(event.target.value)
                setSaved(false)
              }}
              placeholder="Same as the main model"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={!backgroundValid || undefined}
              data-testid="settings-background-model"
              className={cn(fieldClass, 'aria-invalid:border-destructive')}
            />
            <div className="flex flex-wrap gap-1">
              {[{ id: '', label: 'Main model' }, ...BACKGROUND_MODEL_OPTIONS].map((option) => (
                <button
                  key={option.id || 'main'}
                  type="button"
                  onClick={() => {
                    setBackgroundModel(option.id)
                    setSaved(false)
                  }}
                  data-testid={`background-preset-${option.id || 'main'}`}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs transition-colors',
                    backgroundModel.trim() === option.id
                      ? 'border-foreground/40 bg-foreground/[0.08] text-foreground'
                      : 'border-border text-muted-foreground hover:bg-secondary hover:text-foreground',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {backgroundValid ? (
              <p className="text-[11px] text-muted-foreground">
                Writes summaries of long threads and takeaway drafts. Free models (<span className="font-mono">:free</span>) may log prompts and have low rate limits; failures fall back to the main model.
              </p>
            ) : (
              <p className="text-[11px] text-destructive" role="alert">
                Model ids look like <span className="font-mono">vendor/model</span>. Leave empty to use the main model.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-foreground">
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
              <span className="text-xs font-medium text-foreground">
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
            </div>
          </details>
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
              <Button type="submit" size="sm" data-testid="settings-save" disabled={!modelValid || !backgroundValid}>
                Save
              </Button>
            </div>
          </DialogFooter>
        </form>
        {/* Not part of the form above: it acts at once, and Save does not cover it. */}
        <div className="-mx-6 -mb-6 flex items-center justify-between gap-3 rounded-b-lg border-t border-border bg-foreground/[0.02] px-6 py-3">
          <span className="text-xs text-muted-foreground">
            Replace this chat with the “What is TreeChat?” walkthrough.
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRestoreDemo}
            data-testid="settings-restore-demo"
          >
            Show walkthrough
          </Button>
        </div>
    </>
  )
}
