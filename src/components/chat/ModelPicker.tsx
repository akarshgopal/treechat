import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ChevronDown, Image as ImageIcon, Search } from 'lucide-react'
import { isModelId } from '@/lib/provider'
import {
  contextLabel,
  loadModelCapabilities,
  modelInfo,
  perMillion,
  type ModelInfo,
} from '@/lib/model-capabilities'
import { useModelCatalog, useModelCatalogFailed } from '@/lib/use-model-catalog'
import { cn } from '@/lib/utils'

/** Newest first (what people usually look for), then by name. */
const newestFirst = (a: ModelInfo, b: ModelInfo) => (b.created ?? 0) - (a.created ?? 0) || a.name.localeCompare(b.name)

/** Enough to scan; typing narrows the rest. */
const MAX_ROWS = 60

type Suggestion = { id: string; label: string }

type Row = { id: string; label: string; info?: ModelInfo; empty?: boolean; custom?: boolean }

/** One line about a model: context, price per million tokens, images. */
export function ModelFacts({ info, className }: { info: ModelInfo; className?: string }) {
  return (
    <span className={cn('flex shrink-0 items-center gap-2 text-[11px] tabular-nums text-muted-foreground', className)}>
      {info.free ? <span className="rounded-sm bg-foreground/10 px-1 text-foreground">free</span> : (
        <span title="USD per million tokens, input / output">{perMillion(info.prompt)} / {perMillion(info.completion)}</span>
      )}
      {info.context ? <span title="Context window">{contextLabel(info.context)}</span> : null}
      {info.vision ? <ImageIcon size={12} aria-label="Reads images" /> : null}
    </span>
  )
}

/**
 * Choose a model: a button naming the current one opens a panel with a
 * search box and OpenRouter's whole list (suggestions first). Search by name
 * or id; a full id that is not listed can still be used, from a "Use …" row.
 * The list loads from OpenRouter's public endpoint (no key).
 */
export function ModelPicker({
  id,
  label,
  value,
  onChange,
  invalid,
  suggestions,
  empty,
  testId,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  suggestions: readonly Suggestion[]
  /** An option meaning "no model of its own", e.g. "Same as the main model". */
  empty?: string
  testId?: string
}) {
  const catalog = useModelCatalog()
  const failed = useModelCatalogFailed()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (!open) return
    void loadModelCapabilities()
    search.current?.focus()
    // Clicking anywhere else closes the panel.
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open])

  const rows = useMemo<Row[]>(() => {
    const trimmed = query.trim()
    const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean)
    const info = (modelId: string) => catalog?.find((model) => model.id === modelId)
    if (words.length === 0) {
      const suggested = suggestions.map((option) => ({ id: option.id, label: option.label, info: info(option.id) }))
      const rest = (catalog ?? [])
        .filter((model) => !suggestions.some((option) => option.id === model.id))
        .sort(newestFirst)
        .map((model) => ({ id: model.id, label: model.name, info: model }))
      return [...(empty ? [{ id: '', label: empty, empty: true }] : []), ...suggested, ...rest].slice(0, MAX_ROWS)
    }
    const matches = (catalog ?? [])
      .filter((model) => words.every((word) => `${model.name} ${model.id}`.toLowerCase().includes(word)))
      .sort(newestFirst)
      .slice(0, MAX_ROWS)
      .map((model) => ({ id: model.id, label: model.name, info: model }))
    // A full id OpenRouter does not list (new, private, or the list failed).
    const custom = isModelId(trimmed) && !matches.some((row) => row.id === trimmed)
      ? [{ id: trimmed, label: `Use “${trimmed}”`, custom: true }]
      : []
    return [...custom, ...matches]
  }, [catalog, empty, query, suggestions])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const close = () => {
    setOpen(false)
    setQuery('')
    trigger.current?.focus()
  }

  const choose = (row: Row) => {
    onChange(row.id)
    close()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const row = rows[active]
      if (row) choose(row)
    } else if (event.key === 'Escape') {
      // Close the panel, not the dialog around it.
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  }

  const selected = value.trim() ? modelInfo(value) : undefined
  const selectedLabel = value.trim()
    ? selected?.name ?? suggestions.find((option) => option.id === value.trim())?.label ?? value.trim()
    : empty ?? 'Choose a model'
  const suggestionIds = new Set(suggestions.map((option) => option.id))
  const searching = query.trim() !== ''

  return (
    <div className="grid gap-1.5" ref={root}>
      <label htmlFor={id} className="text-xs font-medium text-foreground">{label}</label>
      <div className="relative">
        <button
          ref={trigger}
          id={id}
          type="button"
          onClick={() => (open ? close() : setOpen(true))}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          data-testid={testId}
          data-value={value}
          title={value || undefined}
          className={cn(
            'flex h-10 w-full items-center gap-3 rounded-md border bg-transparent px-3 text-left shadow-sm transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            invalid ? 'border-destructive' : 'border-input',
          )}
        >
          <span className="min-w-0 flex-1">
            <span className={cn('block truncate text-sm', value.trim() ? 'text-foreground' : 'text-muted-foreground')}>{selectedLabel}</span>
            {value.trim() && selectedLabel !== value.trim() ? <span className="block truncate text-[11px] text-muted-foreground">{value.trim()}</span> : null}
          </span>
          {selected ? <ModelFacts info={selected} /> : null}
          <ChevronDown size={14} className="shrink-0 text-muted-foreground" aria-hidden />
        </button>
        {open ? (
          <div className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border bg-paper shadow-xl">
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search size={14} className="shrink-0 text-muted-foreground" aria-hidden />
              <input
                ref={search}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setActive(0)
                }}
                onKeyDown={onKeyDown}
                placeholder="Search models, or paste an id…"
                spellCheck={false}
                autoComplete="off"
                role="combobox"
                aria-expanded
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={rows[active] ? `${listId}-${active}` : undefined}
                aria-label={`Search ${label.toLowerCase()}`}
                data-testid={testId ? `${testId}-search` : undefined}
                className="h-10 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={`${label} options`}
              className="max-h-64 overflow-y-auto p-1"
              data-testid={testId ? `${testId}-options` : undefined}
            >
              {rows.map((row, index) => {
                const heading = !searching && index > 0 && suggestionIds.has(rows[index - 1]!.id) && !suggestionIds.has(row.id) && !row.empty
                const current = row.id === value.trim()
                return (
                  <li key={row.id || 'empty'} role="presentation">
                    {heading ? <p className="px-2 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">All models</p> : null}
                    <div
                      id={`${listId}-${index}`}
                      data-index={index}
                      role="option"
                      aria-selected={current}
                      onMouseMove={() => setActive(index)}
                      onClick={() => choose(row)}
                      className={cn('flex min-h-9 cursor-pointer items-center gap-3 rounded-md px-2 py-1', index === active && 'bg-secondary')}
                      data-model-id={row.id}
                      data-active={index === active || undefined}
                    >
                      <Check size={13} className={cn('shrink-0', current ? 'text-foreground' : 'invisible')} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate text-[13px]', row.empty || row.custom ? 'text-muted-foreground' : 'text-foreground')}>{row.label}</span>
                        {row.empty || row.custom ? null : <span className="block truncate text-[11px] text-muted-foreground">{row.id}</span>}
                      </span>
                      {row.info ? <ModelFacts info={row.info} /> : null}
                    </div>
                  </li>
                )
              })}
              {searching && rows.length === 0 ? (
                <li className="px-2 py-3 text-[13px] text-muted-foreground" role="presentation">
                  {catalog || failed ? 'No model matches. Paste a full id (vendor/model) to use one that is not listed.' : 'Loading OpenRouter’s models…'}
                </li>
              ) : null}
              {!catalog && !searching ? (
                <li className="px-2 py-2 text-[11px] text-muted-foreground" role="presentation">
                  {failed ? 'Could not load OpenRouter’s full list. Pick a suggestion, or paste a model id.' : 'Loading OpenRouter’s full list…'}
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  )
}
