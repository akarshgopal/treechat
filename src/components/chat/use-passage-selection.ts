import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChipState } from '@/components/chat/shell-context'
import { offsetsInRoot, selectableMessageFromRange, selectionClientRect, snapRangeToWords } from '@/lib/selection'

/**
 * The passage selected in a message, snapped to whole words, as the lens bar
 * shows it. It follows the page selection as it changes, scrolls or resizes.
 */
export function usePassageSelection() {
  const [chip, setChip] = useState<ChipState | null>(null)
  /** The last passage, for the branch shortcut (cleared with the selection). */
  const lastRangeRef = useRef<ChipState | null>(null)
  /** Pressing a lens collapses the selection; hold the passage through it. */
  const holdChipRef = useRef(false)

  const syncChipFromSelection = useCallback(() => {
    const selection = window.getSelection()
    // Forget the range with the chip: the shortcut must never branch from a
    // passage the person has already deselected.
    const clear = () => {
      setChip(null)
      lastRangeRef.current = null
    }
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      if (!holdChipRef.current) clear()
      return
    }
    holdChipRef.current = false
    const range = snapRangeToWords(selection.getRangeAt(0))
    const el = selectableMessageFromRange(range)
    if (!el) {
      clear()
      return
    }
    const offsets = offsetsInRoot(el, range)
    if (!offsets) {
      clear()
      return
    }
    const threadId = el.dataset.threadId
    const messageId = el.dataset.messageId
    if (!threadId || !messageId) return
    const host = el.getBoundingClientRect()
    const rect = selectionClientRect(range) ?? {
      top: host.top,
      left: host.left + host.width / 2,
      bottom: host.bottom,
    }
    const next: ChipState = {
      threadId,
      messageId,
      start: offsets.start,
      end: offsets.end,
      quote: offsets.text.trim(),
      top: rect.top,
      left: rect.left,
      bottom: rect.bottom,
      range,
    }
    lastRangeRef.current = next
    setChip(next)
  }, [])

  const onSelectMessage = useCallback((_threadId: string, _messageId: string) => syncChipFromSelection(), [syncChipFromSelection])

  const clearSelection = useCallback(() => {
    setChip(null)
    lastRangeRef.current = null
    holdChipRef.current = false
    window.getSelection()?.removeAllRanges()
  }, [])

  /** Drop the passage but keep the page selection (a question takes over). */
  const forget = useCallback(() => {
    setChip(null)
    lastRangeRef.current = null
    holdChipRef.current = false
  }, [])

  const hold = useCallback(() => {
    holdChipRef.current = true
  }, [])

  const lastPassage = useCallback(() => lastRangeRef.current, [])

  useEffect(() => {
    let frame = 0
    const sync = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        syncChipFromSelection()
      })
    }
    document.addEventListener('selectionchange', sync)
    window.addEventListener('scroll', sync, true)
    window.addEventListener('resize', sync)
    return () => {
      document.removeEventListener('selectionchange', sync)
      window.removeEventListener('scroll', sync, true)
      window.removeEventListener('resize', sync)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [syncChipFromSelection])

  return { chip, lastPassage, clearSelection, forget, hold, onSelectMessage }
}
