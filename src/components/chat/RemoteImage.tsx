import { useState, type ComponentProps } from 'react'
import type { ExtraProps } from 'react-markdown'
import { Image as ImageIcon } from 'lucide-react'
import { safeHttpUrl, sourceHost } from '@/lib/citation-markers'
import { OFFSET_IGNORE_ATTR } from '@/lib/selection'

/**
 * An image in a model reply or a fetched page, shown only when asked for.
 *
 * Loading it automatically would let text the model read (a web page, a
 * document) make it write an image URL carrying the conversation, which the
 * browser would then send off. So it starts as a placeholder naming the site;
 * a click loads it, without a referrer. Non-web URLs never load.
 */
export function RemoteImage({ node: _node, src, alt }: ComponentProps<'img'> & ExtraProps) {
  const [shown, setShown] = useState(false)
  const url = typeof src === 'string' ? safeHttpUrl(src) : undefined
  const host = sourceHost(url)
  const label = alt?.trim() || 'Image'
  if (url && shown) {
    return <img src={url} alt={alt ?? ''} loading="lazy" referrerPolicy="no-referrer" className="max-w-full" />
  }
  return (
    <button
      type="button"
      // Chrome, not message text: branch offsets skip it.
      {...{ [OFFSET_IGNORE_ATTR]: '' }}
      className="my-1 inline-flex max-w-full items-center gap-1.5 rounded-md border border-border px-2 py-1 align-middle text-xs text-muted-foreground hover:border-input hover:text-foreground disabled:cursor-default disabled:hover:border-border disabled:hover:text-muted-foreground"
      onClick={() => setShown(true)}
      disabled={!url}
      title={url ? `Load this image from ${host}` : 'This image cannot be shown'}
      data-testid="remote-image"
    >
      <ImageIcon size={13} className="shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
      {host ? <span className="shrink-0 opacity-70">· {host} · show</span> : null}
    </button>
  )
}
