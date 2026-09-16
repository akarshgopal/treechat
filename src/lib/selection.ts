export type TextRange = {
  start: number
  end: number
  text: string
}

export function offsetsInRoot(root: HTMLElement): TextRange | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null
  }
  const range = selection.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null
  const pre = document.createRange()
  pre.selectNodeContents(root)
  pre.setEnd(range.startContainer, range.startOffset)
  const start = pre.toString().length
  const text = range.toString()
  if (!text.trim()) return null
  return { start, end: start + text.length, text }
}

export type Mark = {
  id: string
  start: number
  end: number
  open: boolean
}

export function splitMarkedText(content: string, marks: Mark[]) {
  const usable = [...marks]
    .filter((mark) => mark.start < mark.end && mark.start >= 0 && mark.end <= content.length)
    .sort((a, b) => a.start - b.start || a.end - b.end)

  const segments: Array<{ text: string; mark?: Mark }> = []
  let cursor = 0
  for (const mark of usable) {
    if (mark.start < cursor) continue
    if (mark.start > cursor) {
      segments.push({ text: content.slice(cursor, mark.start) })
    }
    segments.push({ text: content.slice(mark.start, mark.end), mark })
    cursor = mark.end
  }
  if (cursor < content.length) {
    segments.push({ text: content.slice(cursor) })
  }
  return segments
}
