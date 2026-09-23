import { useLayoutEffect, type RefObject } from 'react'

/**
 * Grow a textarea with its content, wrapped lines included, up to `max`
 * pixels; past that it scrolls.
 */
export function useAutosize(ref: RefObject<HTMLTextAreaElement | null>, value: string, max: number) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const next = Math.min(el.scrollHeight + (el.offsetHeight - el.clientHeight), max)
    el.style.height = `${next}px`
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }, [ref, value, max])
}
