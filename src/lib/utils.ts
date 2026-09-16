import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function isModKey(event: KeyboardEvent | ReactKeyboardEvent) {
  return event.metaKey || event.ctrlKey
}
