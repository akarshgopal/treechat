import type { ChatMessage, ChatSession, Citation, Thread, TreeState } from '@/types'
import { safeHttpUrl } from './citation-markers.ts'
import { childThreads, threadTitle } from './tree.ts'

/**
 * A whole chat as one read-only HTML file: inline dark CSS, no scripts, no
 * external requests (a Content-Security-Policy says so too), branches nested
 * in `<details>` under the message they grew from. Everything from the chat
 * is escaped; links are kept only when they are http(s), and images are
 * named rather than fetched.
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** A link to an http(s) address, or just its text. `text` is already HTML. */
function link(href: string, text: string): string {
  const safe = safeHttpUrl(href)
  return safe ? `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${text}</a>` : text
}

/**
 * Inline Markdown on raw text: code spans, images (named, never loaded),
 * links, bold and italics. Every piece of text is escaped on its way out.
 */
export function inlineMarkdown(raw: string): string {
  let out = ''
  let rest = raw
  const pattern = /`([^`]+)`|!\[([^\]]*)\]\(([^)\s]*)[^)]*\)|\[([^\]]+)\]\(([^)\s]+)[^)]*\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/
  for (let match = pattern.exec(rest); match; match = pattern.exec(rest)) {
    out += escapeHtml(rest.slice(0, match.index))
    const [whole, code, alt, , linkText, href, bold, bold2, italic, bare] = match
    if (code !== undefined) out += `<code>${escapeHtml(code)}</code>`
    else if (alt !== undefined) out += `<span class="img">[image${alt ? `: ${escapeHtml(alt)}` : ''}]</span>`
    else if (linkText !== undefined) out += link(href!, inlineMarkdown(linkText))
    else if (bold !== undefined || bold2 !== undefined) out += `<strong>${inlineMarkdown(bold ?? bold2!)}</strong>`
    else if (italic !== undefined) out += `<em>${inlineMarkdown(italic)}</em>`
    else if (bare !== undefined) out += link(bare, escapeHtml(bare))
    else out += escapeHtml(whole)
    rest = rest.slice(match.index + whole.length)
  }
  return out + escapeHtml(rest)
}

/**
 * Block Markdown: fenced code, headings, lists, quotes, rules, tables as
 * text, paragraphs. Good enough to read a reply; never raw HTML.
 */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks: string[] = []
  let index = 0
  const isBlockStart = (line: string) => /^(```|~~~|#{1,6}\s|>\s?|\s*[-*+]\s|\s*\d+[.)]\s|(-{3,}|\*{3,}|_{3,})\s*$)/.test(line)
  while (index < lines.length) {
    const line = lines[index]!
    if (!line.trim()) {
      index += 1
      continue
    }
    const fence = line.match(/^(```|~~~)\s*([\w+-]*)/)
    if (fence) {
      const body: string[] = []
      index += 1
      while (index < lines.length && !lines[index]!.startsWith(fence[1]!)) body.push(lines[index++]!)
      index += 1
      blocks.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      // Inside a message, headings sit below the thread's own.
      const level = Math.min(6, heading[1]!.length + 2)
      blocks.push(`<h${level}>${inlineMarkdown(heading[2]!.replace(/\s#+\s*$/, ''))}</h${level}>`)
      index += 1
      continue
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push('<hr>')
      index += 1
      continue
    }
    if (/^>\s?/.test(line)) {
      const body: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index]!)) body.push(lines[index++]!.replace(/^>\s?/, ''))
      blocks.push(`<blockquote>${markdownToHtml(body.join('\n'))}</blockquote>`)
      continue
    }
    const ordered = /^\s*\d+[.)]\s/.test(line)
    if (ordered || /^\s*[-*+]\s/.test(line)) {
      const items: string[] = []
      const item = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/
      while (index < lines.length && lines[index]!.trim()) {
        const current = lines[index]!.match(item)
        if (current) items.push(current[1]!)
        else if (items.length > 0) items[items.length - 1] += ` ${lines[index]!.trim()}`
        index += 1
      }
      const tag = ordered ? 'ol' : 'ul'
      blocks.push(`<${tag}>${items.map((entry) => `<li>${inlineMarkdown(entry.replace(/^\[[ xX]\]\s+/, ''))}</li>`).join('')}</${tag}>`)
      continue
    }
    const paragraph: string[] = []
    while (index < lines.length && lines[index]!.trim() && (paragraph.length === 0 || !isBlockStart(lines[index]!))) paragraph.push(lines[index++]!)
    blocks.push(`<p>${paragraph.map(inlineMarkdown).join('<br>')}</p>`)
  }
  return blocks.join('\n')
}

function sources(citations: Citation[]): string {
  const items = citations.map((citation) => {
    const title = escapeHtml(citation.title)
    const where = citation.locator ? ` <span class="muted">· ${escapeHtml(citation.locator)}</span>` : ''
    return `<li><span class="muted">[${escapeHtml(citation.id)}]</span> ${citation.url ? link(citation.url, title) : title}${where}</li>`
  })
  return `<ol class="sources">${items.join('')}</ol>`
}

function messageHtml(message: ChatMessage, state: TreeState): string {
  if (message.kind === 'drop-summary') {
    const from = message.sourceThreadId && state.threads[message.sourceThreadId]
      ? `<p class="muted">Takeaway from “${escapeHtml(threadTitle(state.threads[message.sourceThreadId]!))}”</p>`
      : '<p class="muted">Takeaway</p>'
    return `<div class="takeaway">${from}${markdownToHtml(message.content)}</div>`
  }
  const files = message.attachments?.length
    ? `<p class="muted">${message.attachments.map((file) => `[${file.kind === 'image' ? 'image' : 'file'}: ${escapeHtml(file.name)}]`).join(' ')}</p>`
    : ''
  const body = message.role === 'user'
    ? `<div class="user">${files}${message.content.trim() ? `<p>${escapeHtml(message.content).replace(/\n/g, '<br>')}</p>` : ''}</div>`
    : `<div class="assistant">${markdownToHtml(message.content)}${message.citations?.length ? sources(message.citations) : ''}</div>`
  return body
}

function threadHtml(thread: Thread, state: TreeState): string {
  const children = childThreads(state, thread.id)
  const placed = new Set<string>()
  const parts: string[] = []
  const branch = (child: Thread) => {
    placed.add(child.id)
    return `<details class="branch"><summary><span class="title">${escapeHtml(threadTitle(child))}</span>${child.anchor ? `<span class="quote">“${escapeHtml(child.anchor.quote)}”</span>` : ''}</summary>${threadHtml(child, state)}</details>`
  }
  for (const message of thread.messages) {
    parts.push(messageHtml(message, state))
    const here = children.filter((child) => child.anchor?.messageId === message.id)
    if (here.length > 0) parts.push(`<div class="branches">${here.map(branch).join('')}</div>`)
  }
  // Branches whose message was since rewritten still belong to this thread.
  const rest = children.filter((child) => !placed.has(child.id))
  if (rest.length > 0) parts.push(`<div class="branches">${rest.map(branch).join('')}</div>`)
  return parts.join('\n')
}

const STYLE = `
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#15171a;color:#e8eae7;font:15px/1.62 "Libre Franklin",system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:22px;margin:0 0 4px}
h3,h4,h5,h6{font-size:15px;margin:1em 0 .3em}
.muted{color:#989a99;font-size:13px}
p{margin:.5em 0}
a{color:oklch(.84 .06 163)}
code{font:13px "IBM Plex Mono",ui-monospace,monospace;background:#101214;border-radius:4px;padding:1px 4px}
pre{background:#101214;border:1px solid #33363a;border-radius:8px;padding:12px;overflow-x:auto}
pre code{padding:0;background:none}
blockquote{margin:.5em 0;padding-left:12px;border-left:2px solid #33363a;color:#c9cdc9}
hr{border:0;border-top:1px solid #33363a}
.user{margin:22px 0 10px auto;max-width:85%;width:fit-content;background:#26292c;border-radius:12px;padding:8px 14px}
.assistant{margin:10px 0 22px}
.takeaway{margin:14px 0;padding:10px 14px;border:1px solid color-mix(in oklch,oklch(.68 .085 163) 30%,transparent);border-radius:12px;background:color-mix(in oklch,oklch(.68 .085 163) 6%,transparent)}
.sources{font-size:13px;color:#c9cdc9;padding-left:20px}
.img{color:#989a99}
.branches{margin:6px 0 18px}
details.branch{margin:8px 0;border-left:2px solid oklch(.68 .085 163);padding-left:14px}
details.branch>summary{cursor:pointer;list-style:none;display:flex;flex-direction:column;gap:2px;padding:4px 0}
details.branch>summary::-webkit-details-marker{display:none}
details.branch>summary .title::before{content:"▸ ";color:oklch(.68 .085 163)}
details.branch[open]>summary .title::before{content:"▾ "}
details.branch>summary .title{font-weight:600;font-size:14px}
details.branch>summary .quote{color:#989a99;font-style:italic;font-size:13px}
`

export function shareHtml(session: ChatSession, now = new Date()): string {
  const state = session.treeState
  const root = state.threads[state.rootId]
  const branchCount = Object.keys(state.threads).length - 1
  const title = escapeHtml(session.title)
  const meta = `A read-only copy from TreeChat · ${escapeHtml(now.toISOString().slice(0, 10))} · ${branchCount} ${branchCount === 1 ? 'branch' : 'branches'}`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<meta name="referrer" content="no-referrer">
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${title}</h1>
<p class="muted">${meta}</p>
${root ? threadHtml(root, state) : ''}
</main>
</body>
</html>
`
}

export function shareFileName(title: string): string {
  const slug = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return `${slug || 'treechat'}.html`
}
