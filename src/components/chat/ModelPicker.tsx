import {
  DEFAULT_OPENROUTER_MODEL,
  OPENROUTER_MODEL_OPTIONS,
  isModelId,
} from '@/lib/provider'
import { cn } from '@/lib/utils'

const fieldClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-invalid:border-destructive'

type ModelPickerProps = {
  value: string
  onChange: (value: string) => void
  id: string
  name?: string
  invalid?: boolean
}

export function ModelPicker({
  value,
  onChange,
  id,
  name,
  invalid,
}: ModelPickerProps) {
  const listId = `${id}-list`

  // Tidy on blur; an invalid id stays put so the form can flag it.
  const commit = (raw: string) => {
    const next = raw.trim() || DEFAULT_OPENROUTER_MODEL
    if (isModelId(next)) onChange(next)
  }

  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-[12px] font-medium text-foreground">
        Model
      </label>
      <input
        id={id}
        name={name}
        list={listId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
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
        aria-invalid={invalid || undefined}
        title={value}
        data-testid="settings-model"
        className={fieldClass}
      />
      <datalist id={listId}>
        {OPENROUTER_MODEL_OPTIONS.map((option) => (
          <option key={option.id} value={option.id} label={option.label} />
        ))}
      </datalist>
    </div>
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
