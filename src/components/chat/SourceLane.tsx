import { useEffect, useRef, useState, type ComponentProps } from 'react'
import Markdown, { type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowLeft, ExternalLink, FileText, Globe, X } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { citationWhere, safeHttpUrl } from '@/lib/citation-markers'
import { loadSourceContent, locateSnippet, type SourceContent } from '@/lib/source-content'
import type { Citation } from '@/types'

type LoadState =
  | { status: 'loading' }
  | { status: 'loaded'; content: SourceContent }
  | { status: 'failed' }

const HIGHLIGHT = 'source-snippet'
const remarkPlugins = [remarkGfm]

/**
 * A cited source, read beside the reply that cites it. Not a thread: nothing
 * here is persisted. The head card carries `data-lane-anchor` so the lane's
 * connector and lead offset work as they do for branches.
 */
export function SourceLane({ laneId, citation, leadOffset, narrow, onClose }: {
  laneId: string
  citation: Citation
  leadOffset: number
  /** Phones: the lane replaces the conversation, so closing reads as Back. */
  narrow: boolean
  onClose: () => void
}) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const bodyRef = useRef<HTMLDivElement>(null)
  const original = citation.kind === 'web' ? safeHttpUrl(citation.url) : undefined
  const where = citationWhere(citation)
  const Icon = citation.kind === 'document' ? FileText : Globe
  const key = `${citation.kind}:${citation.url ?? ''}:${citation.documentId ?? ''}:${citation.id}`

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    loadSourceContent(citation, controller.signal).then(
      (content) => { if (!controller.signal.aborted) setState({ status: 'loaded', content }) },
      () => { if (!controller.signal.aborted) setState({ status: 'failed' }) },
    )
    return () => controller.abort()
    // `key` identifies the source; the citation object is rebuilt on renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Paint the cited passage inside the page and bring it into view.
  useEffect(() => {
    const body = bodyRef.current
    if (state.status !== 'loaded' || !body) return
    const range = snippetRange(body, citation.snippet)
    body.dataset.snippet = range ? 'found' : 'missing'
    if (!range) return
    const supported = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'
    if (supported) CSS.highlights.set(HIGHLIGHT, new Highlight(range))
    const target = range.startContainer.parentElement
    const viewport = body.closest<HTMLElement>('[data-radix-scroll-area-viewport]')
    if (target && viewport) {
      const top = target.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop
      viewport.scrollTop = Math.max(0, top - viewport.clientHeight / 3)
    }
    return () => {
      if (supported) CSS.highlights.delete(HIGHLIGHT)
    }
  }, [state, citation.snippet])

  return (
    <div className="flex h-full min-h-0 flex-col" data-lane-id={laneId}>
      <div className="flex h-12 min-w-0 shrink-0 items-center gap-1 border-b border-border px-3">
        {narrow ? (
          <button type="button" className="icon-button" onClick={onClose} aria-label="Back to conversation" title="Back" data-testid="close-source">
            <ArrowLeft size={15} />
          </button>
        ) : null}
        <Icon size={15} className="ml-1.5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="flex min-w-0 flex-1 items-baseline gap-2 px-1.5" title={where ? `${citation.title} · ${where}` : citation.title}>
          <p className="min-w-0 truncate text-[13px] text-foreground" data-testid="source-title">{citation.title}</p>
          {where ? <span className="min-w-0 shrink-[2] truncate text-xs text-muted-foreground">{where}</span> : null}
        </div>
        {original ? (
          <a className="btn" href={original} target="_blank" rel="noopener noreferrer" data-testid="source-original" aria-label="Open original" title="Open original">
            <ExternalLink size={14} /> <span className="hidden lg:inline">Open original</span>
          </a>
        ) : null}
        {narrow ? null : (
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close source" title="Close source (Esc)" data-testid="close-source">
            <X size={15} />
          </button>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1" data-testid="source-scroll">
        <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6">
          <div aria-hidden className="lane-lead" style={{ height: leadOffset }} />
          <div data-lane-anchor className="mb-4 border-l-2 border-branch pl-3" data-testid="source-anchor">
            <p className="text-xs text-muted-foreground">Source {citation.id}</p>
            {citation.snippet ? (
              <p className="line-clamp-3 text-[13px] italic leading-snug text-muted-foreground">“{citation.snippet}”</p>
            ) : null}
          </div>
          {state.status === 'loading' ? (
            <p className="text-sm text-muted-foreground" role="status" data-testid="source-loading">Loading source…</p>
          ) : state.status === 'failed' ? (
            <div className="flex flex-col items-start gap-3 text-sm" data-testid="source-fallback">
              <p className="text-muted-foreground">
                {citation.kind === 'web'
                  ? 'This page could not be loaded here — the reader service may be unavailable or blocked by the site. The cited passage is quoted above.'
                  : 'This document could not be opened here. The cited passage is quoted above.'}
              </p>
              {original ? (
                <a className="btn btn-outline" href={original} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={14} /> Open original
                </a>
              ) : null}
            </div>
          ) : (
            <div ref={bodyRef} className="tc-md text-sm leading-[1.6]" data-testid="source-content">
              {state.content.markdown?.trim() ? (
                <Markdown remarkPlugins={remarkPlugins} components={{ a: SourceLink, img: SourceImage }}>
                  {state.content.markdown}
                </Markdown>
              ) : (
                (state.content.text ?? '').split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function SourceLink({ node: _node, href, children, ...props }: ComponentProps<'a'> & ExtraProps) {
  const safe = safeHttpUrl(href)
  if (!safe) return <span>{children}</span>
  return <a {...props} href={safe} target="_blank" rel="noopener noreferrer">{children}</a>
}

/** Third-party pages: images load lazily and without telling the host where from. */
function SourceImage({ node: _node, alt, ...props }: ComponentProps<'img'> & ExtraProps) {
  return <img {...props} alt={alt ?? ''} loading="lazy" referrerPolicy="no-referrer" className="max-w-full" />
}

/** The DOM range of `snippet` inside `root`'s text, if it can be found. */
function snippetRange(root: HTMLElement, snippet: string | undefined): Range | null {
  const nodes: Text[] = []
  const starts: number[] = []
  let text = ''
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text)
    starts.push(text.length)
    text += node.nodeValue ?? ''
  }
  const found = locateSnippet(text, snippet)
  if (!found) return null
  const at = (offset: number, end: boolean) => {
    // An end offset on a node boundary belongs to the node before it.
    let index = starts.length - 1
    while (index > 0 && (end ? starts[index]! >= offset : starts[index]! > offset)) index -= 1
    return { node: nodes[index]!, offset: offset - starts[index]! }
  }
  const start = at(found.start, false)
  const end = at(found.end, true)
  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  return range
}
