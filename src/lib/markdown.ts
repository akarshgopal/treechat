import { splitMarkedText, OFFSET_IGNORE_ATTR, type Mark } from './selection.ts'

/**
 * Message bodies are stored as a markdown/plain string. Branch anchors are
 * offsets into the *visible* text of the rendered markdown — the concatenation
 * of text nodes in the message body, excluding `[data-offset-ignore]` chrome
 * (fence language labels, copy buttons, mark superscripts).
 *
 * Typical assistant replies without markdown syntax keep source === visible
 * text, so seeded character-range anchors still match after GFM rendering.
 */

export type HastText = { type: 'text'; value: string }

export type HastElement = {
  type: 'element'
  tagName: string
  properties?: Record<string, unknown>
  children: HastChild[]
}

export type HastChild =
  | HastElement
  | HastText
  | { type: string; value?: string; children?: HastChild[] }

export type HastRoot = { type: 'root'; children: HastChild[] }

export function languageFromClassName(
  className: string | ReadonlyArray<string> | undefined | null,
): string {
  const raw = Array.isArray(className)
    ? className.join(' ')
    : typeof className === 'string'
      ? className
      : ''
  const match = /\blanguage-([a-z0-9_+-]+)\b/i.exec(raw)
  return match?.[1]?.toLowerCase() ?? ''
}

function isIgnoredElement(node: HastElement): boolean {
  const properties = node.properties ?? {}
  return (
    properties[OFFSET_IGNORE_ATTR] != null ||
    properties.dataOffsetIgnore != null
  )
}

export function hastPlainText(node: HastRoot | HastChild): string {
  if (node.type === 'text') return (node as HastText).value
  if (node.type === 'element') {
    const element = node as HastElement
    if (isIgnoredElement(element)) return ''
    return (element.children ?? []).map(hastPlainText).join('')
  }
  if ('children' in node && Array.isArray(node.children)) {
    return node.children.map(hastPlainText).join('')
  }
  return ''
}

function markElement(text: string, marks: Mark[]): HastElement {
  const open = marks.find((mark) => mark.open)
  return {
    type: 'element',
    tagName: 'mark',
    properties: {
      className: ['branch-mark'],
      dataOpen: open ? 'true' : 'false',
      dataOpenId: open?.id ?? '',
      dataSiblings: marks.length > 1 ? 'true' : 'false',
      dataCount: String(marks.length),
      dataMarkIds: marks.map((mark) => mark.id).join(' '),
    },
    children: [{ type: 'text', value: text }],
  }
}

/**
 * Wrap marked ranges in the HAST tree. Offsets are into `hastPlainText(tree)`,
 * the same stream `offsetsInRoot` uses on the rendered DOM (minus ignore chrome).
 */
export function wrapHastWithMarks(tree: HastRoot, marks: Mark[]): void {
  const plain = hastPlainText(tree)
  const segments = splitMarkedText(plain, marks)
  if (!segments.some((segment) => segment.marks)) return

  let index = 0
  let consumed = 0

  function take(count: number): Array<{ text: string; marks?: Mark[] }> {
    const parts: Array<{ text: string; marks?: Mark[] }> = []
    let left = count
    while (left > 0 && index < segments.length) {
      const segment = segments[index]
      const remain = segment.text.length - consumed
      const slice = Math.min(remain, left)
      parts.push({
        text: segment.text.slice(consumed, consumed + slice),
        marks: segment.marks,
      })
      consumed += slice
      left -= slice
      if (consumed >= segment.text.length) {
        index += 1
        consumed = 0
      }
    }
    return parts
  }

  function rewrite(node: HastRoot | HastElement): void {
    const children = node.children
    if (!children?.length) return
    const next: HastChild[] = []
    for (const child of children) {
      if (child.type === 'text') {
        const value = (child as HastText).value
        for (const part of take(value.length)) {
          if (!part.text) continue
          next.push(
            part.marks
              ? markElement(part.text, part.marks)
              : { type: 'text', value: part.text },
          )
        }
      } else if (child.type === 'element') {
        const element = child as HastElement
        if (!isIgnoredElement(element)) rewrite(element)
        next.push(element)
      } else {
        next.push(child)
      }
    }
    node.children = next
  }

  rewrite(tree)
}

export function rehypeBranchMarks(marks: Mark[]) {
  return function attacher() {
    return function transform(tree: HastRoot) {
      wrapHastWithMarks(tree, marks)
    }
  }
}
