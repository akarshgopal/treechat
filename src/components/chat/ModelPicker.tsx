import { useState } from 'react'
import {
  DEFAULT_OPENROUTER_MODEL,
  OPENROUTER_MODEL_OPTIONS,
} from '@/lib/provider'
import { cn } from '@/lib/utils'

const fieldClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

type ModelPickerProps = {
  value: string
  onChange: (value: string) => void
  onCommit?: (value: string) => void
  id: string
  name?: string
  compact?: boolean
  testId?: string
}

function isPreset(value: string) {
  return OPENROUTER_MODEL_OPTIONS.some((option) => option.id === value)
}

export function ModelPicker({
  value,
  onChange,
  onCommit,
  id,
  name,
  compact,
  testId,
}: ModelPickerProps) {
  const listId = `${id}-list`

  const commit = (raw: string) => {
    const next = raw.trim() || DEFAULT_OPENROUTER_MODEL
    onChange(next)
    onCommit?.(next)
  }

  return (
    <div className={cn('grid', compact ? 'gap-0' : 'gap-1.5')}>
      {!compact ? (
        <label htmlFor={id} className="text-[12px] font-medium text-foreground">
          Model
        </label>
      ) : null}
      <input
        id={id}
        name={name}
        list={listId}
        value={value}
        onChange={(event) => {
          const next = event.target.value
          onChange(next)
          if (onCommit && isPreset(next.trim())) onCommit(next.trim())
        }}
        onBlur={() => commit(value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit(value)
            event.currentTarget.blur()
          }
        }}
        placeholder={DEFAULT_OPENROUTER_MODEL}
        spellCheck={false}
        autoComplete="off"
        aria-label="OpenRouter model"
        title={value}
        data-testid={testId ?? (compact ? 'header-model' : 'settings-model')}
        className={cn(
          fieldClass,
          compact &&
            'h-7 w-[9.5rem] px-2 font-mono text-[10.5px] text-muted-foreground shadow-none sm:w-[12.5rem]',
        )}
      />
      <datalist id={listId}>
        {OPENROUTER_MODEL_OPTIONS.map((option) => (
          <option key={option.id} value={option.id} label={option.label} />
        ))}
      </datalist>
    </div>
  )
}

type HeaderModelPickerProps = {
  model: string
  onCommit: (model: string) => void
}

export function HeaderModelPicker({ model, onCommit }: HeaderModelPickerProps) {
  const [draft, setDraft] = useState(model)
  const [syncedModel, setSyncedModel] = useState(model)
  if (model !== syncedModel) {
    setSyncedModel(model)
    setDraft(model)
  }

  return (
    <ModelPicker
      compact
      id="header-model"
      value={draft}
      onChange={setDraft}
      onCommit={(next) => {
        if (next === model) return
        onCommit(next)
      }}
    />
  )
}

export function ModelPresetChips({
  value,
  onSelect,
}: {
  value: string
  onSelect: (model: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {OPENROUTER_MODEL_OPTIONS.map((option) => {
        const active = value === option.id
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onSelect(option.id)}
            data-testid={`model-preset-${option.id}`}
            className={cn(
              'rounded-full border px-2 py-[3px] font-mono text-[10px] transition-colors',
              active
                ? 'border-branch/50 bg-branch/10 text-branch-bright'
                : 'border-border text-muted-foreground hover:bg-secondary hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
