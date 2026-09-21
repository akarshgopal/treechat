export type TextRange = {
  start: number
  end: number
  text: string
}

/** Sanity cap only — long in-message selections should still branch. */
export const MAX_BRANCH_SELECTION = 8_000

export const SELECTABLE_MESSAGE = '[data-message-id][data-selectable="true"]'

const SHOW_TEXT = 4
const DOCUMENT_POSITION_PRECEDING = 2
const DOCUMENT_POSITION_FOLLOWING = 4

function isElement(node: Node): node is Element {
  return node.nodeType === 1
}

function isText(node: Node): boolean {
  return node.nodeType === 3 || node.nodeType === 4
}

function closestSelectable(node: Node | null): HTMLElement | null {
  if (!node) return null
  const el = isElement(node) ? node : node.parentElement
  return el?.closest<HTMLElement>(SELECTABLE_MESSAGE) ?? null
}

function isInside(root: Node, node: Node): boolean {
  return root === node || (typeof root.contains === 'function' && root.contains(node))
}

function childIndex(parent: Node, child: Node): number {
  let index = 0
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n === child) return index
    index += 1
  }
  return -1
}

/** Child at a Range boundary, so element-level points resolve into the message. */
function nodeAtBoundary(node: Node, offset: number, side: 'start' | 'end'): Node {
  if (isText(node)) return node
  if (side === 'start') {
    return node.childNodes[offset] ?? node.childNodes[offset - 1] ?? node
  }
  if (offset > 0) return node.childNodes[offset - 1] ?? node
  return node.previousSibling ?? node.parentNode ?? node
}

/**
 * Where a Range point sits relative to `root`.
 * -1 before, 0 inside (including the leading/trailing element boundary), 1 after.
 */
function comparePointToRoot(
  root: Node,
  node: Node,
  offset: number,
  side: 'start' | 'end',
): -1 | 0 | 1 {
  if (isInside(root, node)) return 0

  if (isInside(node, root)) {
    let child: Node | null = root
    while (child && child.parentNode !== node) child = child.parentNode
    if (!child) return 1
    const index = childIndex(node, child)
    if (offset < index) return -1
    if (offset > index) return 1
    return side === 'start' ? 0 : -1
  }

  const pos = root.compareDocumentPosition(node)
  if (pos & DOCUMENT_POSITION_PRECEDING) return -1
  if (pos & DOCUMENT_POSITION_FOLLOWING) return 1
  return 1
}

function selectedTextInNode(range: Range, node: Node): string {
  const content = node.textContent ?? ''
  const start = node === range.startContainer ? range.startOffset : 0
  const end = node === range.endContainer ? range.endOffset : content.length
  if (end <= start) return ''
  return content.slice(start, end)
}

function nodeIntersectsRange(range: Range, node: Node): boolean {
  if (typeof range.intersectsNode === 'function') {
    try {
      return range.intersectsNode(node)
    } catch {
      /* fall through */
    }
  }
  return selectedTextInNode(range, node).length > 0
}

function rangeHasNonWhitespaceOutside(range: Range, root: Node): boolean {
  const ancestor = range.commonAncestorContainer
  if (isText(ancestor)) {
    return !isInside(root, ancestor) && range.toString().trim() !== ''
  }
  const doc = root.ownerDocument
  if (!doc) return true
  const walker = doc.createTreeWalker(ancestor, SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (isInside(root, node)) continue
    if (!nodeIntersectsRange(range, node)) continue
    if (selectedTextInNode(range, node).trim()) return true
  }
  return false
}

function prefixTextLength(root: Node, target: Node): number {
  const doc = root.ownerDocument
  if (!doc) return 0
  const walker = doc.createTreeWalker(root, SHOW_TEXT)
  let n = 0
  let current: Node | null
  while ((current = walker.nextNode())) {
    if (current === target) return n
    if (isElement(target) && target.contains(current)) return n
    n += current.textContent?.length ?? 0
  }
  return n
}

/** Character offset in `root.textContent` for a DOM point. */
export function pointToOffset(root: Node, node: Node, offset: number): number | null {
  if (!isInside(root, node)) return null
  if (isText(node)) {
    const len = node.textContent?.length ?? 0
    const clamped = Math.max(0, Math.min(offset, len))
    return prefixTextLength(root, node) + clamped
  }
  let n = node === root ? 0 : prefixTextLength(root, node)
  const limit = Math.max(0, Math.min(offset, node.childNodes.length))
  for (let i = 0; i < limit; i += 1) {
    n += node.childNodes[i]?.textContent?.length ?? 0
  }
  return n
}

function offsetsFromClampedRange(root: HTMLElement, range: Range): TextRange | null {
  if (rangeHasNonWhitespaceOutside(range, root)) return null

  const startCmp = comparePointToRoot(root, range.startContainer, range.startOffset, 'start')
  const endCmp = comparePointToRoot(root, range.endContainer, range.endOffset, 'end')
  if (startCmp > 0 || endCmp < 0) return null

  const total = root.textContent?.length ?? 0
  const start = isInside(root, range.startContainer)
    ? pointToOffset(root, range.startContainer, range.startOffset)
    : 0
  const end = isInside(root, range.endContainer)
    ? pointToOffset(root, range.endContainer, range.endOffset)
    : total
  if (start == null || end == null) return null
  const lo = Math.min(start, end)
  const hi = Math.max(start, end)
  const text = (root.textContent ?? '').slice(lo, hi)
  if (!text.trim()) return null
  if (text.length > MAX_BRANCH_SELECTION) return null
  return { start: lo, end: hi, text }
}

/**
 * Map a live Range (or the current selection) onto character offsets inside
 * `root`. Works when the Range spans nested inline/block nodes, and when the
 * browser parks endpoints on the element just outside the message (triple-click
 * / full-paragraph). Returns null if the selection is collapsed, empty, huge,
 * or includes text from outside `root`.
 */
export function offsetsInRoot(root: HTMLElement, range?: Range | null): TextRange | null {
  try {
    const resolved =
      range ??
      (typeof window !== 'undefined' && window.getSelection()?.rangeCount
        ? window.getSelection()!.getRangeAt(0)
        : null)
    if (!resolved || resolved.collapsed) return null
    return offsetsFromClampedRange(root, resolved)
  } catch {
    return null
  }
}

/**
 * The selectable message that wholly owns this range, or null if the selection
 * leaves a single `[data-message-id][data-selectable=true]` root.
 */
export function selectableMessageFromRange(range: Range): HTMLElement | null {
  if (range.collapsed) return null

  const startHit = closestSelectable(
    nodeAtBoundary(range.startContainer, range.startOffset, 'start'),
  )
  if (startHit && offsetsFromClampedRange(startHit, range)) return startHit

  const endHit = closestSelectable(nodeAtBoundary(range.endContainer, range.endOffset, 'end'))
  if (endHit && offsetsFromClampedRange(endHit, range)) return endHit

  const scope = isElement(range.commonAncestorContainer)
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement
  if (!scope) return null

  const self = closestSelectable(scope)
  if (self && (self === scope || self.contains(scope)) && offsetsFromClampedRange(self, range)) {
    return self
  }

  const hits: HTMLElement[] = []
  scope.querySelectorAll<HTMLElement>(SELECTABLE_MESSAGE).forEach((el) => {
    if (offsetsFromClampedRange(el, range)) hits.push(el)
  })
  return hits.length === 1 ? hits[0] : null
}

export type SelectionBox = {
  top: number
  left: number
  bottom: number
}

/** First/last client rects — `getBoundingClientRect()` is often empty across blocks. */
export function selectionClientRect(range: Range): SelectionBox | null {
  const rects = range.getClientRects()
  const visible: DOMRect[] = []
  for (let i = 0; i < rects.length; i += 1) {
    const r = rects[i]
    if (r.width > 0 || r.height > 0) visible.push(r)
  }
  if (visible.length > 0) {
    let minLeft = visible[0].left
    let maxRight = visible[0].right
    for (const r of visible) {
      if (r.left < minLeft) minLeft = r.left
      if (r.right > maxRight) maxRight = r.right
    }
    return {
      top: visible[0].top,
      left: (minLeft + maxRight) / 2,
      bottom: visible[visible.length - 1].bottom,
    }
  }
  const box = range.getBoundingClientRect()
  if (box.width === 0 && box.height === 0) return null
  return {
    top: box.top,
    left: box.left + box.width / 2,
    bottom: box.bottom,
  }
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
