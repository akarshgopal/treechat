import { useRef, useState, type FormEvent } from 'react'
import { newIssueUrl, REPO_URL } from '@/lib/links'
import { KeyUsagePanel } from '@/components/chat/KeyUsage'
import { ModelPicker } from '@/components/chat/ModelPicker'
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
  PROVIDER_PRESETS,
  baseUrlOrigin,
  chatCompletionsUrl,
  formatHeaderLines,
  isLiveConfig,
  isModelIdFor,
  loadProviderConfig,
  normalizeProviderConfig,
  parseBaseUrl,
  parseExtraBody,
  parseHeaderLines,
  providerName,
  saveProviderConfig,
  type ClientProviderConfig,
} from '@/lib/provider'

const fieldClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

/** What the provider list offers: OpenRouter, a ready-made server, or one typed in. */
type ProviderChoice = 'openrouter' | 'custom' | (typeof PROVIDER_PRESETS)[number]['id']

function choiceFor(config: ClientProviderConfig | null): ProviderChoice {
  if (!config || config.provider === 'openrouter') return 'openrouter'
  return PROVIDER_PRESETS.find((preset) => preset.baseUrl === config.baseUrl)?.id ?? 'custom'
}

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
  const initialChoice = choiceFor(initial)
  const [choice, setChoice] = useState<ProviderChoice>(initialChoice)
  const preset = PROVIDER_PRESETS.find((entry) => entry.id === choice)
  const openRouter = choice === 'openrouter'
  const [baseUrl, setBaseUrl] = useState(initial?.provider === 'openai-compatible' ? initial.baseUrl ?? '' : '')
  const [headers, setHeaders] = useState(formatHeaderLines(initial?.headers))
  const [extraBody, setExtraBody] = useState(initial?.extraBody ? JSON.stringify(initial.extraBody, null, 2) : '')
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? '')
  const [model, setModel] = useState(initial?.model || (initial ? '' : DEFAULT_OPENROUTER_MODEL))
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
  const kind = openRouter ? 'openrouter' : 'openai-compatible'
  const modelValid = isModelIdFor(kind, model)
  const backgroundValid = !backgroundModel.trim() || isModelIdFor(kind, backgroundModel)
  const urlValid = openRouter || parseBaseUrl(baseUrl) !== undefined
  const headersValid = openRouter || parseHeaderLines(headers) !== undefined
  const extraBodyValid = openRouter || parseExtraBody(extraBody) !== undefined
  /**
   * A saved key or header belongs to the server it was saved for. Pointing the
   * URL somewhere else while they are unchanged would send them to a new host,
   * so Save waits until they are re-entered or cleared.
   */
  const storedNow = loadProviderConfig()
  const parsedUrl = parseBaseUrl(baseUrl)
  const newOrigin = baseUrlOrigin(parsedUrl)
  const oldOrigin = storedNow?.provider === 'openai-compatible' ? baseUrlOrigin(storedNow.baseUrl) : undefined
  const sameHeaders = headers.trim() !== '' && formatHeaderLines(storedNow?.headers) === headers.trim()
  const sameKey = apiKey !== '' && apiKey === storedNow?.apiKey
  const carriesSecrets = !openRouter && oldOrigin !== undefined && newOrigin !== undefined && newOrigin !== oldOrigin && (sameKey || sameHeaders)
  const formValid = modelValid && backgroundValid && urlValid && headersValid && extraBodyValid && !carriesSecrets
  /** What is stored now (read each render, so it follows Save, Remove key and Disconnect). */
  const stored = loadProviderConfig()
  const storedOpenRouter = !stored || stored.provider === 'openrouter'
  const storedCustom = isLiveConfig(stored) && stored.provider === 'openai-compatible'
  const changed = () => setSaved(false)

  /**
   * A key belongs to the provider it was typed for: switching never carries
   * it to another server. Coming back to the saved provider restores its key.
   */
  const chooseProvider = (next: ProviderChoice) => {
    if (next === choice) return
    const nextPreset = PROVIDER_PRESETS.find((entry) => entry.id === next)
    setChoice(next)
    setApiKey(next === initialChoice ? initial?.apiKey ?? '' : '')
    setBaseUrl(next === initialChoice && initial?.baseUrl ? initial.baseUrl : nextPreset?.baseUrl ?? '')
    setModel(next === 'openrouter' ? DEFAULT_OPENROUTER_MODEL : nextPreset?.models[0]?.id ?? '')
    setBackgroundModel('')
    // Headers often hold a gateway secret, so they follow the key's rule.
    const back = next === initialChoice
    setHeaders(back ? formatHeaderLines(initial?.headers) : '')
    setExtraBody(back && initial?.extraBody ? JSON.stringify(initial.extraBody, null, 2) : '')
    changed()
  }

  const persist = (event: FormEvent) => {
    event.preventDefault()
    if (!formValid) return
    const next = normalizeProviderConfig({
      provider: kind,
      apiKey,
      model,
      backgroundModel,
      ...(openRouter ? {} : {
        baseUrl,
        headers: parseHeaderLines(headers),
        extraBody: parseExtraBody(extraBody) ?? undefined,
      }),
      temperature: temperature.trim() === '' ? undefined : temperature,
      maxTokens: maxTokens.trim() === '' ? undefined : maxTokens,
    })
    saveProviderConfig(next)
    onConfigChange(next)
    setApiKey(next.apiKey)
    setBaseUrl(next.baseUrl ?? '')
    setHeaders(formatHeaderLines(next.headers))
    setExtraBody(next.extraBody ? JSON.stringify(next.extraBody, null, 2) : '')
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
    // A custom server is live without a key, so forgetting the key alone would
    // not go back to the demo: "Disconnect" drops the server too.
    const wasOpenRouter = (loadProviderConfig()?.provider ?? 'openrouter') === 'openrouter'
    const next = normalizeProviderConfig(wasOpenRouter ? { ...(loadProviderConfig() ?? {}), apiKey: '' } : {})
    saveProviderConfig(next)
    setApiKey('')
    setSavedKey('')
    if (!wasOpenRouter) {
      setChoice('openrouter')
      setBaseUrl('')
      setHeaders('')
      setExtraBody('')
      setModel(DEFAULT_OPENROUTER_MODEL)
      setBackgroundModel('')
    }
    setSaved(false)
    onConfigChange(next)
  }

  return (
    <>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Add an OpenRouter key, or connect your own OpenAI-compatible server,
            for real answers. Without one, TreeChat replies with demo text so
            you can try branching.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={persist} className="grid gap-4" autoComplete="off">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Provider</span>
            <select
              value={choice}
              onChange={(event) => chooseProvider(event.target.value as ProviderChoice)}
              data-testid="settings-provider"
              className={fieldClass}
            >
              <option value="openrouter">OpenRouter</option>
              {PROVIDER_PRESETS.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.label}</option>
              ))}
              <option value="custom">Custom server…</option>
            </select>
          </label>
          {openRouter ? null : (
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-foreground">Base URL</span>
              <input
                type="url"
                name="provider-base-url"
                value={baseUrl}
                onChange={(event) => {
                  setBaseUrl(event.target.value)
                  changed()
                }}
                placeholder="https://your-server.example/v1"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={!urlValid || undefined}
                data-testid="settings-base-url"
                className={fieldClass}
              />
              {carriesSecrets ? (
                <span className="text-[11px] text-destructive" role="alert" data-testid="settings-secrets-warning">
                  This is a different server from the one your saved key or headers are for. Enter the key and headers again (or clear them) to save.
                </span>
              ) : urlValid ? (
                <span className="text-[11px] text-muted-foreground">
                  Requests go to <span className="font-mono">{parsedUrl ? chatCompletionsUrl(parsedUrl) : '…/chat/completions'}</span>. The server must allow requests from this page (CORS).
                </span>
              ) : (
                <span className="text-[11px] text-destructive" role="alert" data-testid="settings-base-url-error">
                  Enter a full http(s) address, e.g. {preset?.baseUrl ?? 'http://localhost:11434/v1'}.
                </span>
              )}
            </label>
          )}
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">
              {openRouter ? 'OpenRouter API key' : preset?.keyOptional || choice === 'custom' ? 'API key (optional)' : `${preset?.label ?? 'API'} key`}
            </span>
            <input
              type="password"
              name="provider-key"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value)
                changed()
              }}
              placeholder={openRouter ? 'sk-or-v1-…' : preset?.keyPlaceholder ?? (choice === 'custom' ? 'Only if the server asks for one' : '')}
              autoComplete="off"
              spellCheck={false}
              data-testid="settings-api-key"
              className={fieldClass}
            />
            <span className="text-[11px] text-muted-foreground">
              Kept only in this browser and sent only to {openRouter ? 'OpenRouter' : parseBaseUrl(baseUrl) ? providerName({ provider: 'openai-compatible', baseUrl: parseBaseUrl(baseUrl) }) : 'the server above'}. Use a key with a credit limit: anything running
              on this site’s address could read it.
            </span>
          </label>
          {hasKey && openRouter && storedOpenRouter ? <KeyUsagePanel apiKey={savedKey} /> : null}
          <div className="grid gap-1.5">
            <ModelPicker
              id="settings-model"
              label="Model"
              testId="settings-model"
              invalid={!modelValid}
              value={model}
              provider={kind}
              suggestions={openRouter ? OPENROUTER_MODEL_OPTIONS : preset?.models ?? []}
              onChange={(next) => {
                setModel(next)
                changed()
              }}
            />
            {modelValid ? (
              <p className="text-[11px] text-muted-foreground">
                {openRouter
                  ? 'Prices are per million tokens, input / output. Any OpenRouter model id works.'
                  : 'Use the model id exactly as your server names it.'}
              </p>
            ) : openRouter ? (
              <p className="text-[11px] text-destructive" role="alert" data-testid="settings-model-error">
                Model ids look like <span className="font-mono">vendor/model</span>, e.g. {savedModel}.
              </p>
            ) : (
              <p className="text-[11px] text-destructive" role="alert" data-testid="settings-model-error">
                Choose or type a model id (no spaces).
              </p>
            )}
          </div>
          <details className="group rounded-lg border border-border" open={Boolean(initial?.backgroundModel || initial?.temperature !== undefined || initial?.maxTokens !== undefined || initial?.headers || initial?.extraBody) || undefined}>
            <summary className="flex h-9 cursor-pointer list-none items-center justify-between rounded-lg px-3 text-[13px] text-muted-foreground hover:text-foreground">
              Advanced
              <span className="text-xs transition-transform group-open:rotate-90" aria-hidden>›</span>
            </summary>
            <div className="grid gap-4 border-t border-border p-3">
          {openRouter ? null : (
            <>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-foreground">Extra headers</span>
                <textarea
                  value={headers}
                  onChange={(event) => {
                    setHeaders(event.target.value)
                    changed()
                  }}
                  rows={3}
                  placeholder={'api-key: …\nX-Team: research'}
                  spellCheck={false}
                  aria-invalid={!headersValid || undefined}
                  data-testid="settings-headers"
                  className={`${fieldClass} h-auto py-2 font-mono text-xs`}
                />
                {headersValid ? (
                  <span className="text-[11px] text-muted-foreground">
                    One <span className="font-mono">Name: value</span> per line, sent with every request and stored like the key. For gateways that want a header other than <span className="font-mono">Authorization</span>.
                  </span>
                ) : (
                  <span className="text-[11px] text-destructive" role="alert" data-testid="settings-headers-error">
                    Each line needs a header name, a colon and a value.
                  </span>
                )}
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-foreground">Extra request options (JSON)</span>
                <textarea
                  value={extraBody}
                  onChange={(event) => {
                    setExtraBody(event.target.value)
                    changed()
                  }}
                  rows={3}
                  placeholder={'{ "reasoning_effort": "low" }'}
                  spellCheck={false}
                  aria-invalid={!extraBodyValid || undefined}
                  data-testid="settings-extra-body"
                  className={`${fieldClass} h-auto py-2 font-mono text-xs`}
                />
                {extraBodyValid ? (
                  <span className="text-[11px] text-muted-foreground">
                    Merged into every request body. The model, messages and streaming can’t be replaced.
                  </span>
                ) : (
                  <span className="text-[11px] text-destructive" role="alert" data-testid="settings-extra-body-error">
                    Must be a JSON object, e.g. {'{ "top_p": 0.9 }'}.
                  </span>
                )}
              </label>
            </>
          )}
          <div className="grid gap-1.5">
            <ModelPicker
              id="settings-background-model"
              label="Background model"
              testId="settings-background-model"
              invalid={!backgroundValid}
              value={backgroundModel}
              provider={kind}
              suggestions={openRouter ? BACKGROUND_MODEL_OPTIONS : preset?.models ?? []}
              empty="Same as the main model"
              onChange={(next) => {
                setBackgroundModel(next)
                setSaved(false)
              }}
            />
            {backgroundValid ? (
              <p className="text-[11px] text-muted-foreground">
                Writes summaries of long threads and takeaway drafts. {openRouter ? <>Free models (<span className="font-mono">:free</span>) may log prompts and have low rate limits; failures</> : 'Failures'} fall back to the main model.
              </p>
            ) : (
              <p className="text-[11px] text-destructive" role="alert">
                {openRouter ? <>Model ids look like <span className="font-mono">vendor/model</span>. Leave empty to use the main model.</> : 'Model ids have no spaces. Leave empty to use the main model.'}
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
            {openRouter && storedOpenRouter && hasKey ? (
              <button type="button" className="btn" onClick={removeKey} data-testid="settings-clear">
                Remove key
              </button>
            ) : storedCustom ? (
              <button type="button" className="btn" onClick={removeKey} data-testid="settings-clear">
                Disconnect
              </button>
            ) : <span />}
            <div className="flex items-center gap-2">
              {saved ? (
                <span className="text-[11px] text-muted-foreground">Saved in this browser</span>
              ) : null}
              <button type="submit" className="btn btn-primary" data-testid="settings-save" disabled={!formValid}>
                Save
              </button>
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
            <button type="button" className="btn btn-outline" onClick={onExport} data-testid="settings-export">Export chats</button>
            <button type="button" className="btn btn-outline" onClick={() => importInput.current?.click()} data-testid="settings-import">
              Import chats…
            </button>
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
            <li>With an OpenRouter key, messages go to OpenRouter and the model you pick. Free models (<span className="font-mono">:free</span>) may log prompts.</li>
            <li>With another provider or your own server, messages go straight from this page to the base URL you set, and nowhere else.</li>
            <li>Opening a cited web page sends its address to the r.jina.ai reader, which fetches it for you.</li>
            <li>Searching documents downloads a small model from Hugging Face and its runtime from jsDelivr, once.</li>
            <li>Without a key or server, replies are demo text generated in this page; nothing leaves the browser.</li>
          </ul>
        </details>
        <div className="-mx-6 -mb-6 flex items-center justify-between gap-3 rounded-b-lg border-t border-border bg-foreground/[0.02] px-6 py-3">
          <div className="flex gap-4">
            <a
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="source-code"
            >
              Source on GitHub
            </a>
            <a
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              href={newIssueUrl()}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="report-problem"
            >
              Report a problem
            </a>
          </div>
          <button
            type="button"
            className="btn"
            onClick={onRestoreDemo}
            data-testid="settings-restore-demo"
            title="Replace this chat with the “What is TreeChat?” walkthrough"
          >
            Show walkthrough here
          </button>
        </div>
    </>
  )
}
