export type TextRange = {
  start: number
  end: number
  text: string
}

/** Fence chrome, copy buttons, mark counts — excluded from branch offsets. */
export const OFFSET_IGNORE_ATTR = 'data-offset-ignore'

function closestOffsetIgnore(node: Node, root: Node): Element | null {
  let el: Element | null =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  while (el) {
    if (el.hasAttribute(OFFSET_IGNORE_ATTR)) return el
    if (el === root) return null
    el = el.parentElement
  }
  return null
}

/** Visible message text: text nodes minus `[data-offset-ignore]` subtrees. */
export function plainTextSkippingIgnore(root: Node): string {
  if (root.nodeType === Node.TEXT_NODE) {
    return closestOffsetIgnore(root, root) ? '' : (root.nodeValue ?? '')
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return closestOffsetIgnore(node, root)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT
    },
  })
  let out = ''
  let current: Node | null
  while ((current = walker.nextNode())) {
    out += current.nodeValue ?? ''
  }
  return out
}

function rangePlainText(range: Range): string {
  const fragment = range.cloneContents()
  fragment.querySelectorAll(`[${OFFSET_IGNORE_ATTR}]`).forEach((el) => {
    el.remove()
  })
  return fragment.textContent ?? ''
}

export function offsetsInRoot(root: HTMLElement): TextRange | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null
  }
  const range = selection.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null
  if (
    closestOffsetIgnore(range.startContainer, root) &&
    closestOffsetIgnore(range.endContainer, root)
  ) {
    return null
  }
  const pre = document.createRange()
  pre.selectNodeContents(root)
  pre.setEnd(range.startContainer, range.startOffset)
  const start = rangePlainText(pre).length
  const text = rangePlainText(range)
  if (!text.trim()) return null
  return { start, end: start + text.length, text }
}

export type Mark = {
  id: string
  start: number
  end: number
  open: boolean
}

export type Segment = { text: string; marks?: Mark[] }

/**
 * Slice `content` into plain and marked segments.
 *
 * Several branches can hang off the exact same span, so a marked segment
 * carries every mark covering it, oldest first. Marks that merely *overlap*
 * (different spans) can't be nested in one pass — first one wins.
 */
export function splitMarkedText(content: string, marks: Mark[]): Segment[] {
  const usable = [...marks]
    .filter((mark) => mark.start < mark.end && mark.start >= 0 && mark.end <= content.length)
    .sort((a, b) => a.start - b.start || a.end - b.end)

  const segments: Segment[] = []
  let cursor = 0
  let i = 0
  while (i < usable.length) {
    const mark = usable[i]
    if (mark.start < cursor) {
      i += 1
      continue
    }
    const group = [mark]
    let j = i + 1
    while (
      j < usable.length &&
      usable[j].start === mark.start &&
      usable[j].end === mark.end
    ) {
      group.push(usable[j])
      j += 1
    }
    if (mark.start > cursor) {
      segments.push({ text: content.slice(cursor, mark.start) })
    }
    segments.push({ text: content.slice(mark.start, mark.end), marks: group })
    cursor = mark.end
    i = j
  }
  if (cursor < content.length) {
    segments.push({ text: content.slice(cursor) })
  }
  return segments
}
