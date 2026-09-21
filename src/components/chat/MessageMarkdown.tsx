import {
  Children,
  isValidElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react'
import Markdown, { type ExtraProps } from 'react-markdown'
import type { PluggableList } from 'unified'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { Check, Copy } from 'lucide-react'
import { languageFromClassName, rehypeBranchMarks } from '@/lib/markdown'
import { OFFSET_IGNORE_ATTR, plainTextSkippingIgnore, type Mark } from '@/lib/selection'
import { cycleOpenId } from '@/lib/tree'
import { cn } from '@/lib/utils'

const remarkPlugins: PluggableList = [remarkGfm]
const highlightPlugin: PluggableList[number] = [
  rehypeHighlight,
  { detect: false, ignoreMissing: true },
]
const EMPTY_MARKS: Mark[] = []

function marksKey(marks: Mark[]): string {
  return marks.map((mark) => `${mark.id}:${mark.start}:${mark.end}:${mark.open ? 1 : 0}`).join('|')
}

type MessageMarkdownProps = {
  content: string
  marks?: Mark[]
  onOpenBranch?: (threadId: string | null) => void
  className?: string
}

export const MessageMarkdown = memo(function MessageMarkdown({
  content,
  marks = EMPTY_MARKS,
  onOpenBranch,
  className,
}: MessageMarkdownProps) {
  const onOpenBranchRef = useRef(onOpenBranch)
  useEffect(() => {
    onOpenBranchRef.current = onOpenBranch
  }, [onOpenBranch])

  const rehypePlugins = useMemo<PluggableList>(
    () => [highlightPlugin, rehypeBranchMarks(marks)],
    [marks],
  )
  const components = useMemo(
    () => ({
      a: MarkdownLink,
      pre: CodeFence,
      code: MarkdownCode,
      table: MarkdownTable,
      input: MarkdownInput,
      mark: (props: ComponentProps<'mark'> & ExtraProps) => (
        <BranchMark {...props} onOpenBranchRef={onOpenBranchRef} />
      ),
    }),
    [],
  )

  return (
    <div className={cn('tc-md', className)}>
      <Markdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {content}
      </Markdown>
    </div>
  )
}, (prev, next) => {
  if (prev.content !== next.content) return false
  if (prev.className !== next.className) return false
  return marksKey(prev.marks ?? EMPTY_MARKS) === marksKey(next.marks ?? EMPTY_MARKS)
})

function MarkdownLink({
  node: _node,
  href,
  children,
  ...props
}: ComponentProps<'a'> & ExtraProps) {
  return (
    <a {...props} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

function MarkdownTable({
  node: _node,
  children,
  ...props
}: ComponentProps<'table'> & ExtraProps) {
  return (
    <div className="tc-md-table-wrap">
      <table {...props}>{children}</table>
    </div>
  )
}

function MarkdownInput({
  node: _node,
  ...props
}: ComponentProps<'input'> & ExtraProps) {
  return <input {...props} disabled className={cn('tc-md-check', props.className)} />
}

function MarkdownCode({
  node: _node,
  className,
  children,
  ...props
}: ComponentProps<'code'> & ExtraProps) {
  const lang = languageFromClassName(className)
  const fenced = Boolean(lang || className?.includes('hljs'))
  return (
    <code className={cn(!fenced && 'tc-md-inline', className)} {...props}>
      {children}
    </code>
  )
}

function languageFromPreChildren(children: ReactNode): string {
  for (const child of Children.toArray(children)) {
    if (!isValidElement(child)) continue
    const className = (child.props as { className?: string | string[] }).className
    const lang = languageFromClassName(className)
    if (lang) return lang
  }
  return ''
}

function CodeFence({
  node: _node,
  children,
  className,
  ...props
}: ComponentProps<'pre'> & ExtraProps) {
  const preRef = useRef<HTMLPreElement>(null)
  const timerRef = useRef(0)
  const [copied, setCopied] = useState(false)
  const lang = languageFromPreChildren(children)

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const onCopy = useCallback(async () => {
    const code = preRef.current?.querySelector('code')
    const text = code ? plainTextSkippingIgnore(code) : ''
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* clipboard may be blocked */
    }
    setCopied(true)
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setCopied(false), 1600)
  }, [])

  return (
    <div className="tc-md-fence">
      <div className="tc-md-fence-bar" {...{ [OFFSET_IGNORE_ATTR]: '' }}>
        <span className="tc-md-fence-lang">{lang || 'code'}</span>
        <button
          type="button"
          className="tc-md-copy"
          aria-label={copied ? 'Copied' : 'Copy code'}
          title={copied ? 'Copied' : 'Copy code'}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation()
            void onCopy()
          }}
        >
          {copied ? <Check size={13} strokeWidth={2.2} /> : <Copy size={13} strokeWidth={2.2} />}
        </button>
      </div>
      <pre ref={preRef} className={cn('tc-md-pre', className)} {...props}>
        {children}
      </pre>
    </div>
  )
}

function BranchMark({
  node: _node,
  children,
  onOpenBranchRef,
  className,
  ...props
}: ComponentProps<'mark'> &
  ExtraProps & {
    onOpenBranchRef: { current: ((threadId: string | null) => void) | undefined }
  }) {
  const attrs = props as Record<string, unknown>
  const ids = String(attrs['data-mark-ids'] ?? '')
    .split(/\s+/)
    .filter(Boolean)
  const openId = String(attrs['data-open-id'] ?? '') || null
  const openIndex = openId ? ids.indexOf(openId) : -1
  const siblings = ids.length > 1
  const nextId = cycleOpenId(ids, openId)

  return (
    <mark
      {...props}
      className={cn('branch-mark bg-transparent text-inherit', className)}
      data-open={openIndex >= 0 ? 'true' : 'false'}
      data-siblings={siblings ? 'true' : 'false'}
      data-count={ids.length}
      title={
        siblings
          ? `${ids.length} branches here — click to cycle`
          : openIndex >= 0
            ? 'Hide this branch'
            : 'Open this branch'
      }
      onClick={(event) => {
        event.stopPropagation()
        onOpenBranchRef.current?.(nextId)
      }}
    >
      {children}
      {siblings ? (
        <sup className="ml-0.5 font-mono text-[9px] font-medium tracking-wide text-branch-bright" {...{ [OFFSET_IGNORE_ATTR]: '' }}>
          {openIndex >= 0 ? `${openIndex + 1}/${ids.length}` : ids.length}
        </sup>
      ) : null}
    </mark>
  )
}
