import { useRef, useState, type FormEvent } from 'react'
import { newIssueUrl } from '@/lib/links'
import { KeyUsagePanel } from '@/components/chat/KeyUsage'
import { ModelPicker } from '@/components/chat/ModelPicker'
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
  BACKGROUND_MODEL_OPTIONS,
  OPENROUTER_MODEL_OPTIONS,
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
  /** Download every chat as a JSON file. */
  onExport: () => void
  /** Add the chats in an exported file. */
  onImport: (file: File) => void
}

export function SettingsDialog({
  open,
  onOpenChange,
  onConfigChange,
  onRestoreDemo,
  onExport,
  onImport,
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
          onExport={onExport}
          onImport={(file) => {
            onImport(file)
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
  onExport,
  onImport,
}: Pick<SettingsDialogProps, 'onConfigChange' | 'onRestoreDemo' | 'onExport' | 'onImport'>) {
  const importInput = useRef<HTMLInputElement>(null)
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
  /** The key as saved; usage is looked up for this one, not a half-typed one. */
  const [savedKey, setSavedKey] = useState(initial?.apiKey ?? '')
  const hasKey = Boolean(savedKey)
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
    setSavedKey(next.apiKey)
    setSaved(true)
  }

  /** Forget the key only; model and generation params stay as saved. */
  const removeKey = () => {
    const next = normalizeProviderConfig({ ...(loadProviderConfig() ?? {}), apiKey: '' })
    saveProviderConfig(next)
    setApiKey('')
    setSavedKey('')
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
              Kept only in this browser and sent only to OpenRouter. Use a key with a credit limit: anything running
              on this site’s address could read it.
            </span>
          </label>
          {hasKey ? <KeyUsagePanel apiKey={savedKey} /> : null}
          <div className="grid gap-1.5">
            <ModelPicker
              id="settings-model"
              name="openrouter-model"
              label="Model"
              testId="settings-model"
              invalid={!modelValid}
              value={model}
              suggestions={OPENROUTER_MODEL_OPTIONS}
              placeholder={DEFAULT_OPENROUTER_MODEL}
              onChange={(next) => {
                setModel(next)
                setSaved(false)
              }}
              onCommit={(next) => {
                // Tidy on leave; an invalid id stays put so the form can flag it.
                const tidy = next.trim() || DEFAULT_OPENROUTER_MODEL
                if (isModelId(tidy)) setModel(tidy)
              }}
            />
            {modelValid ? (
              <p className="text-[11px] text-muted-foreground">
                Search OpenRouter’s models by name, or paste any model id. Prices are per million tokens, input / output.
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
            <ModelPicker
              id="settings-background-model"
              name="openrouter-background-model"
              label="Background model"
              testId="settings-background-model"
              invalid={!backgroundValid}
              value={backgroundModel}
              suggestions={BACKGROUND_MODEL_OPTIONS}
              empty="Same as the main model"
              placeholder="Same as the main model"
              onChange={(next) => {
                setBackgroundModel(next)
                setSaved(false)
              }}
            />
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
        {/* Not part of the form above: these act at once, and Save does not cover them. */}
        <section className="grid gap-2" aria-labelledby="settings-chats">
          <h3 id="settings-chats" className="text-xs font-medium text-foreground">Your chats</h3>
          <p className="text-[11px] text-muted-foreground">
            Chats are saved only in this browser. Export them to keep a copy or move them to another browser; documents
            are not included.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onExport} data-testid="settings-export">Export chats</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => importInput.current?.click()} data-testid="settings-import">
              Import chats…
            </Button>
            <input
              ref={importInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              data-testid="settings-import-input"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) onImport(file)
              }}
            />
          </div>
        </section>
        <details className="group text-[11px] text-muted-foreground" data-testid="settings-privacy">
          <summary className="cursor-pointer list-none text-xs font-medium text-foreground">
            Where your data goes <span className="text-muted-foreground transition-transform group-open:inline-block group-open:rotate-90">›</span>
          </summary>
          <ul className="mt-2 grid list-disc gap-1 pl-4">
            <li>There is no TreeChat server. Chats, settings and documents stay in this browser.</li>
            <li>With a key, messages go to OpenRouter and the model you pick. Free models (<span className="font-mono">:free</span>) may log prompts.</li>
            <li>Opening a cited web page sends its address to the r.jina.ai reader, which fetches it for you.</li>
            <li>Searching documents downloads a small model from Hugging Face and its runtime from jsDelivr, once.</li>
            <li>Without a key, replies are demo text generated in this page; nothing leaves the browser.</li>
          </ul>
        </details>
        <div className="-mx-6 -mb-6 flex items-center justify-between gap-3 rounded-b-lg border-t border-border bg-foreground/[0.02] px-6 py-3">
          <a
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            href={newIssueUrl()}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="report-problem"
          >
            Report a problem
          </a>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRestoreDemo}
            data-testid="settings-restore-demo"
            title="Replace this chat with the “What is TreeChat?” walkthrough"
          >
            Show walkthrough here
          </Button>
        </div>
    </>
  )
}
