import assert from 'node:assert/strict'
import test from 'node:test'
import { createSeedState } from './seed.ts'
import { escapeHtml, inlineMarkdown, markdownToHtml, shareFileName, shareHtml } from './share-html.ts'
import type { ChatSession } from '../types.ts'

const chat = (): ChatSession => ({ id: 's1', title: 'What is <TreeChat>?', createdAt: 1, updatedAt: 1, titleLocked: true, treeState: createSeedState() })

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

test('Markdown blocks: headings, lists, quotes, emphasis and code', () => {
  const html = markdownToHtml('# Top\n\nSome **bold** and *soft* `code`.\n\n- one\n- two\n\n1. first\n\n> quoted')
  assert.ok(html.includes('<h3>Top</h3>'))
  assert.ok(html.includes('<p>Some <strong>bold</strong> and <em>soft</em> <code>code</code>.</p>'))
  assert.ok(html.includes('<ul><li>one</li><li>two</li></ul>'))
  assert.ok(html.includes('<ol><li>first</li></ol>'))
  assert.ok(html.includes('<blockquote><p>quoted</p></blockquote>'))
})

test('the whole tree is in one self-contained file, branches nested under their message', () => {
  const session = chat()
  session.treeState.threads['thread-root']!.messages.push({
    id: 'takeaway-1', role: 'assistant', content: 'Branches keep their place.', createdAt: 9, kind: 'drop-summary', sourceThreadId: 'thread-branch-1',
  })
  session.treeState.threads['thread-branch-1']!.messages[1]!.citations = [{ id: '1', kind: 'web', title: 'A <page>', url: 'https://example.com/p' }]
  const html = shareHtml(session, new Date('2026-09-28T12:00:00Z'))
  assert.ok(html.startsWith('<!doctype html>'))
  assert.ok(html.includes("default-src 'none'"))
  assert.ok(!/<script|<link|<img|<iframe|\ssrc=/i.test(html))
  assert.ok(html.includes('<title>What is &lt;TreeChat&gt;?</title>'))
  assert.ok(html.includes('2 branches'))
  const branch = html.indexOf('<details class="branch"><summary><span class="title">If I keep talking')
  const nested = html.indexOf('<details class="branch"><summary><span class="title">So how deep')
  const anchorMessage = html.indexOf('When a reply goes wide')
  assert.ok(anchorMessage > 0 && branch > anchorMessage && nested > branch)
  assert.ok(html.slice(branch, nested).includes('<span class="quote">“select any passage and grow a branch from it”</span>'))
  assert.ok(html.includes('Takeaway from “If I keep talking'))
  assert.ok(html.includes('A &lt;page&gt;</a>'))
})

test('file names come from the title', () => {
  assert.equal(shareFileName('Why is the sky blue?'), 'why-is-the-sky-blue.html')
  assert.equal(shareFileName('???'), 'treechat.html')
})
