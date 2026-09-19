import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function isModKey(event: KeyboardEvent | ReactKeyboardEvent) {
  return event.metaKey || event.ctrlKey
}

export function isBranchShortcut(event: KeyboardEvent | ReactKeyboardEvent) {
  return (
    isModKey(event) &&
    event.shiftKey &&
    (event.code === 'KeyB' || event.key.toLowerCase() === 'b')
  )
}

export function branchShortcutLabel() {
  if (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)) {
    return '⌘⇧B'
  }
  return 'Ctrl+⇧B'
}

export function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}…` : text
}
