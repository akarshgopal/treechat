import assert from 'node:assert/strict'
import test from 'node:test'
import { escapeHtml, inlineMarkdown, markdownToHtml } from './share-html.ts'

test('everything from the chat is escaped', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
  const html = markdownToHtml('Hi <script>alert(1)</script> <img src=x onerror=alert(1)>\n\n```html\n<b>code</b>\n```')
  assert.ok(!html.includes('<script'))
  assert.ok(!html.includes('<img'))
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
  assert.ok(html.includes('<pre><code>&lt;b&gt;code&lt;/b&gt;</code></pre>'))
})

test('only http(s) links survive, opened safely; images are named, never loaded', () => {
  const html = inlineMarkdown('[ok](https://example.com/a?b="c") [bad](javascript:alert(1)) [data](data:text/html,x) ![chart](https://example.com/c.png) https://example.org/page.')
  assert.ok(html.includes('<a href="https://example.com/a?b=%22c%22" target="_blank" rel="noopener noreferrer">ok</a>'))
  assert.ok(!/javascript:|href="data:/.test(html))
  assert.ok(html.includes('bad'))
  assert.ok(html.includes('[image: chart]'))
  assert.ok(!html.includes('c.png'))
  assert.ok(html.includes('<a href="https://example.org/page" target="_blank" rel="noopener noreferrer">https://example.org/page</a>.'))
})
