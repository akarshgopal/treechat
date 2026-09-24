import assert from 'node:assert/strict'
import test from 'node:test'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import {
  hastPlainText,
  wrapHastWithMarks,
  type HastElement,
  type HastRoot,
} from './markdown.ts'
import { OFFSET_IGNORE_ATTR, type Mark } from './selection.ts'

function parseMarkdown(markdown: string): HastRoot {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype)
  return processor.runSync(processor.parse(markdown)) as HastRoot
}

function marksIn(node: HastRoot | HastElement): HastElement[] {
  const found: HastElement[] = []
  function walk(current: HastRoot | HastElement) {
    for (const child of current.children ?? []) {
      if (child.type !== 'element') continue
      const element = child as HastElement
      if (element.tagName === 'mark') found.push(element)
      walk(element)
    }
  }
  walk(node)
  return found
}

const mark = (id: string, start: number, end: number, open = false): Mark => ({
  id,
  start,
  end,
  open,
})

test('fenced code visible text is the code, not the language tag', () => {
  const tree = parseMarkdown('```ts\nconst x = 1\n```')
  const plain = hastPlainText(tree)
  assert.equal(plain.includes('const x = 1'), true)
  assert.equal(plain.includes('ts'), false)
})

test('chrome with data-offset-ignore is skipped in visible text', () => {
  const tree: HastRoot = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'div',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { [OFFSET_IGNORE_ATTR]: '' },
            children: [{ type: 'text', value: 'jsCopy' }],
          },
          { type: 'text', value: 'const x = 1' },
        ],
      },
    ],
  }
  assert.equal(hastPlainText(tree), 'const x = 1')
})

test('wrapHastWithMarks wraps the visible range, not markdown source offsets', () => {
  const tree = parseMarkdown('alpha **beta** gamma')
  assert.equal(hastPlainText(tree), 'alpha beta gamma')
  wrapHastWithMarks(tree, [mark('a', 6, 10, true)])
  const wrapped = marksIn(tree)
  assert.equal(wrapped.length, 1)
  assert.equal(hastPlainText(wrapped[0]), 'beta')
  assert.equal(wrapped[0].properties?.dataOpen, 'true')
  assert.equal(wrapped[0].properties?.dataMarkIds, 'a')
})

test('wrapHastWithMarks splits across highlight-style spans', () => {
  const tree: HastRoot = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'pre',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: { className: ['hljs', 'language-js'] },
            children: [
              {
                type: 'element',
                tagName: 'span',
                properties: { className: ['hljs-keyword'] },
                children: [{ type: 'text', value: 'const' }],
              },
              { type: 'text', value: ' x = 1' },
            ],
          },
        ],
      },
    ],
  }
  assert.equal(hastPlainText(tree), 'const x = 1')
  wrapHastWithMarks(tree, [mark('a', 6, 7)])
  const wrapped = marksIn(tree)
  assert.equal(wrapped.length, 1)
  assert.equal(hastPlainText(wrapped[0]), 'x')
})
