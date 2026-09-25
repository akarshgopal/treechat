import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import {
  contextLabel,
  loadModelCapabilities,
  modelInfo,
  perMillion,
  type ModelInfo,
} from '@/lib/model-capabilities'
import { useModelCatalog } from '@/lib/use-model-catalog'
import { cn } from '@/lib/utils'

const fieldClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-invalid:border-destructive'

/** Enough to scan; typing narrows the rest. */
const MAX_ROWS = 60

type Suggestion = { id: string; label: string }

type Row = { id: string; label: string; info?: ModelInfo; empty?: boolean }

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
 * A model id field with OpenRouter's whole list behind it: type to search by
 * name or id, or paste any id. Suggestions come first while the field is
 * untouched. The list loads from OpenRouter's public endpoint (no key).
 */
export function ModelPicker({
  id,
  name,
  label,
  value,
  onChange,
  onCommit,
  invalid,
  suggestions,
  empty,
  placeholder,
  testId,
}: {
  id: string
  name?: string
  label: string
  value: string
  onChange: (value: string) => void
  /** Tidy the value when the field is left (e.g. restore a default). */
  onCommit?: (value: string) => void
  invalid?: boolean
  suggestions: readonly Suggestion[]
  /** An option meaning "no model of its own", e.g. "Same as the main model". */
  empty?: string
  placeholder?: string
  testId?: string
}) {
  const catalog = useModelCatalog()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const listId = useId()
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (open) void loadModelCapabilities()
  }, [open])

  const rows = useMemo<Row[]>(() => {
    const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
    const info = (modelId: string) => catalog?.find((model) => model.id === modelId)
    if (words.length === 0) {
      const suggested = suggestions.map((option) => ({ id: option.id, label: option.label, info: info(option.id) }))
      const rest = (catalog ?? [])
        .filter((model) => !suggestions.some((option) => option.id === model.id))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((model) => ({ id: model.id, label: model.name, info: model }))
      return [...(empty ? [{ id: '', label: empty, empty: true }] : []), ...suggested, ...rest].slice(0, MAX_ROWS)
    }
    return (catalog ?? [])
      .filter((model) => words.every((word) => `${model.name} ${model.id}`.toLowerCase().includes(word)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MAX_ROWS)
      .map((model) => ({ id: model.id, label: model.name, info: model }))
  }, [catalog, empty, query, suggestions])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (row: Row) => {
    onChange(row.id)
    onCommit?.(row.id)
    setQuery(null)
    setOpen(false)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setActive((index) => Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const row = open ? rows[active] : undefined
      if (row && query !== null) choose(row)
      else {
        onCommit?.(value)
        setOpen(false)
      }
    } else if (event.key === 'Escape' && open) {
      // Close the list, not the dialog around it.
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      setQuery(null)
    }
  }

  const selected = value.trim() ? modelInfo(value) : undefined
  const suggestionIds = new Set(suggestions.map((option) => option.id))
  const searching = query !== null && query.trim() !== ''

  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-foreground">{label}</label>
      <div className="relative">
        <input
          id={id}
          name={name}
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
            setQuery(event.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Let a click on a row land before the list closes.
            window.setTimeout(() => {
              setOpen(false)
              setQuery(null)
            }, 120)
            onCommit?.(value)
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && rows[active] ? `${listId}-${active}` : undefined}
          aria-invalid={invalid || undefined}
          title={value}
          data-testid={testId}
          className={fieldClass}
        />
        {open ? (
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={`${label} options`}
            className="absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-paper p-1 shadow-xl"
            data-testid={testId ? `${testId}-options` : undefined}
            onMouseDown={(event) => event.preventDefault()}
          >
            {rows.map((row, index) => {
              const heading = !searching && index > 0 && suggestionIds.has(rows[index - 1]!.id) && !suggestionIds.has(row.id) && !row.empty
              return (
                <li key={row.id || 'empty'} role="presentation">
                  {heading ? <p className="px-2 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">All models</p> : null}
                  <div
                    id={`${listId}-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={index === active}
                    onMouseMove={() => setActive(index)}
                    onClick={() => choose(row)}
                    className={cn(
                      'flex min-h-9 cursor-pointer items-center gap-3 rounded-md px-2 py-1',
                      index === active ? 'bg-secondary' : '',
                    )}
                    data-model-id={row.id}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-[13px]', row.empty ? 'text-muted-foreground' : 'text-foreground')}>{row.label}</span>
                      {row.empty ? null : <span className="block truncate text-[11px] text-muted-foreground">{row.id}</span>}
                    </span>
                    {row.info ? <ModelFacts info={row.info} /> : null}
                  </div>
                </li>
              )
            })}
            {searching && rows.length === 0 ? (
              <li className="px-2 py-3 text-[13px] text-muted-foreground" role="presentation">
                {catalog ? 'No model matches. Any OpenRouter id works — keep typing it.' : 'Loading OpenRouter’s models…'}
              </li>
            ) : null}
            {!catalog && !searching ? (
              <li className="px-2 py-2 text-[11px] text-muted-foreground" role="presentation">Loading OpenRouter’s full list…</li>
            ) : null}
          </ul>
        ) : null}
      </div>
      {selected ? (
        <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground" data-testid={testId ? `${testId}-facts` : undefined}>
          <span className="text-foreground">{selected.name}</span>
          <ModelFacts info={selected} />
        </p>
      ) : null}
    </div>
  )
}
