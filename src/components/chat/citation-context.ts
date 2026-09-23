import { createContext } from 'react'
import type { Citation } from '@/types'

export type CitationContextValue = {
  byId: Map<string, Citation>
  /** The citation whose source lane is open from this message, if any. */
  openId: string | null
  onOpen?: (citationId: string) => void
}

/** Markdown components are created once; the message's sources reach them here. */
export const CitationContext = createContext<CitationContextValue>({ byId: new Map(), openId: null })
