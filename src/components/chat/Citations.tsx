import { useContext, type ComponentProps } from 'react'
import type { ExtraProps } from 'react-markdown'
import { FileText, Globe } from 'lucide-react'
import { citationWhere } from '@/lib/citation-markers'
import { OFFSET_IGNORE_ATTR } from '@/lib/selection'
import { cn } from '@/lib/utils'
import type { Citation } from '@/types'
import { CitationContext } from '@/components/chat/citation-context'

const ignore = { [OFFSET_IGNORE_ATTR]: '' }

/**
 * `sup` renderer: a marker the citation plugin recognised becomes a chip.
 * Its children are the marker text itself (`[`, `1`, `]`), so the message's
 * visible text — and every branch anchor into it — is unchanged.
 */
export function CitationSup({ node: _node, children, ...props }: ComponentProps<'sup'> & ExtraProps) {
  const { byId, openId, onOpen } = useContext(CitationContext)
  const id = String((props as Record<string, unknown>)['data-citation-id'] ?? '')
  const citation = id ? byId.get(id) : undefined
  if (!citation) return <sup {...props}>{children}</sup>
  const where = citationWhere(citation)
  return (
    <sup {...props} className="cite-ref">
      <button
        type="button"
        className="cite-chip"
        aria-label={`Source ${citation.id}: ${citation.title}`}
        aria-expanded={openId === citation.id}
        data-open={openId === citation.id ? 'true' : 'false'}
        data-testid="citation-chip"
        onClick={(event) => {
          event.stopPropagation()
          onOpen?.(citation.id)
        }}
      >
        {children}
      </button>
      <span className="cite-tip" role="presentation" aria-hidden {...ignore}>
        <span className="block font-medium text-foreground">{citation.title}</span>
        {where ? <span className="block text-muted-foreground">{where}</span> : null}
      </span>
    </sup>
  )
}

/** Compact numbered list of a reply's sources, under the reply. */
export function SourcesList({ messageId, citations, openId, onOpen }: {
  messageId: string
  citations: Citation[]
  openId: string | null
  onOpen?: (citationId: string) => void
}) {
  return (
    <section aria-label="Sources" data-testid="sources-list" data-sources-for={messageId} className="mt-1 border-t border-border/70 pt-2">
      <ol className="flex flex-col gap-0.5">
        {citations.map((citation) => {
          const Icon = citation.kind === 'document' ? FileText : Globe
          const where = citationWhere(citation)
          const open = openId === citation.id
          return (
            <li key={citation.id}>
              <button
                type="button"
                onClick={() => onOpen?.(citation.id)}
                aria-expanded={open}
                data-testid="source-entry"
                data-citation-id={citation.id}
                title={citation.title}
                className={cn(
                  'flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-foreground/[0.05]',
                  open ? 'bg-foreground/[0.08] text-foreground' : 'text-muted-foreground',
                )}
              >
                <span className="w-4 shrink-0 text-right font-mono text-[11px] text-muted-foreground">{citation.id}</span>
                <Icon size={13} className="shrink-0" aria-label={citation.kind === 'document' ? 'Document' : 'Web page'} />
                <span className="min-w-0 truncate text-foreground">{citation.title}</span>
                {where ? <span className="min-w-0 shrink-[2] truncate">{where}</span> : null}
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
