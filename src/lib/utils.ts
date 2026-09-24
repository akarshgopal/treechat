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

type NavigatorUAData = {
  platform?: string
}

function detectPlatform() {
  if (typeof navigator === 'undefined') return ''
  const uaData =
    'userAgentData' in navigator
      ? (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData
      : undefined
  return uaData?.platform || navigator.platform || ''
}

export function isApplePlatform(platform = detectPlatform()) {
  return /Mac|iPhone|iPad|iPod/i.test(platform)
}

export function branchShortcutLabel(platform = detectPlatform()) {
  return isApplePlatform(platform) ? '⌘⇧B' : 'Ctrl+⇧B'
}

export function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}…` : text
}
