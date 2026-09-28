import { lazy, useEffect, useState } from 'react'

/**
 * Not needed for first paint, so they load in their own chunks: fetched once
 * the app is idle, or on first use if that comes sooner.
 */
const loadSettingsDialog = () => import('@/components/chat/SettingsDialog')
const loadDocumentsDialog = () => import('@/components/chat/DocumentsDialog')
const loadCommandPalette = () => import('@/components/chat/CommandPalette')
const loadTakeawayDialog = () => import('@/components/chat/TakeawayDialog')
const loadSourceLane = () => import('@/components/chat/SourceLane')
const loadMapOverlay = () => import('@/components/chat/MapOverlay')
const loadLearnDrawer = () => import('@/components/chat/LearnDrawer')
export const SettingsDialog = lazy(() => loadSettingsDialog().then((module) => ({ default: module.SettingsDialog })))
export const DocumentsDialog = lazy(() => loadDocumentsDialog().then((module) => ({ default: module.DocumentsDialog })))
export const CommandPalette = lazy(() => loadCommandPalette().then((module) => ({ default: module.CommandPalette })))
export const TakeawayDialog = lazy(() => loadTakeawayDialog().then((module) => ({ default: module.TakeawayDialog })))
export const SourceLane = lazy(() => loadSourceLane().then((module) => ({ default: module.SourceLane })))
export const MapOverlay = lazy(() => loadMapOverlay().then((module) => ({ default: module.MapOverlay })))
export const LearnDrawer = lazy(() => loadLearnDrawer().then((module) => ({ default: module.LearnDrawer })))

export function usePrefetchLazyParts() {
  useEffect(() => {
    const prefetch = () => {
      for (const load of [loadSettingsDialog, loadDocumentsDialog, loadCommandPalette, loadTakeawayDialog, loadSourceLane, loadMapOverlay, loadLearnDrawer]) void load().catch(() => undefined)
    }
    const idle = window.requestIdleCallback?.(prefetch, { timeout: 5_000 }) ?? window.setTimeout(prefetch, 2_000)
    return () => {
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle)
      else window.clearTimeout(idle)
    }
  }, [])
}

/** True from the first time `open` is: a lazy dialog then stays mounted, so it can animate closed. */
export function useOpenedOnce(open: boolean) {
  const [opened, setOpened] = useState(open)
  if (open && !opened) setOpened(true)
  return opened || open
}
