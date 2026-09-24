import type { ReactNode } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'

export type MenuItem =
  | {
      label: string
      icon?: ReactNode
      onSelect: () => void
      /** Shown with a check when true, for on/off items. */
      checked?: boolean
      destructive?: boolean
      testId?: string
    }
  | 'separator'

/** A ⋯ button that opens a short list of actions. */
export function Menu({ label, items, testId, align = 'end' }: {
  label: string
  items: MenuItem[]
  testId?: string
  align?: 'start' | 'end'
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="icon-button" aria-label={label} title={label} data-testid={testId}>
          <MoreHorizontal size={16} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={4}
          className="z-50 min-w-44 rounded-lg border border-border bg-paper p-1 shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          {items.map((item, index) =>
            item === 'separator' ? (
              <DropdownMenu.Separator key={`separator-${index}`} className="my-1 h-px bg-border" />
            ) : (
              <DropdownMenu.Item
                key={item.label}
                onSelect={item.onSelect}
                data-testid={item.testId}
                role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                aria-checked={item.checked}
                className={cn(
                  'flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] outline-none data-[highlighted]:bg-secondary',
                  item.destructive ? 'text-destructive' : 'text-foreground',
                )}
              >
                <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                {item.checked ? <Check className="size-3.5 text-foreground" aria-hidden /> : null}
              </DropdownMenu.Item>
            ),
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
