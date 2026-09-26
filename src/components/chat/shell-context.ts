import { createContext, useContext } from 'react'
import type { Attachment, ProviderStatus } from '@/types'

/** A passage selected in a message: where it is and what it says. */
export type ChipState = {
  threadId: string
  messageId: string
  start: number
  end: number
  quote: string
  top: number
  left: number
  bottom: number
  /** The passage in the DOM, snapped to whole words. */
  range: Range | null
}

/** A source open beside the reply that cites it. Shell state, never persisted. */
export type OpenSource = { threadId: string; messageId: string; citationId: string }

/**
 * What every lane needs from the shell around it. Lanes render per thread, so
 * drilling these as props would mean re-threading a dozen of them at each level.
 */
export type ShellValue = {
  draftFor: (threadId: string) => string
  setDraft: (threadId: string, value: string) => void
  /** Files waiting in a thread's composer, sent with its next message. */
  attachmentsFor: (threadId: string) => Attachment[]
  setAttachments: (threadId: string, update: (current: Attachment[]) => Attachment[]) => void
  status: ProviderStatus
  onSwitchModel: (model: string) => void
  registerComposer: (threadId: string, el: HTMLTextAreaElement | null) => void
  onSelectMessage: (threadId: string, messageId: string) => void
  onOpenChild: (parentId: string, childId: string | null) => void
  onFocus: (threadId: string) => void
  onMerge: (threadId: string) => void
  onDiscard: (threadId: string) => void
  onAskMessage: (threadId: string, messageId: string) => void
  onReturn: (threadId: string, takeawayId?: string) => void
  scrollPositions: Map<string, number>
  sessionId: string
  onShowDemo: () => void
  openSource: OpenSource | null
  onOpenSource: (threadId: string, messageId: string, citationId: string) => void
  /** Phones: one lane at a time, and the app bar names the chat. */
  narrow: boolean
  onRenameChat: (title: string) => void
  onDeleteChat: () => void
  /** Web search was just switched on somewhere: mention its cost once. */
  onWebSearchOn: () => void
}

export const ShellContext = createContext<ShellValue | null>(null)

export function useShell() {
  const value = useContext(ShellContext)
  if (!value) throw new Error('ShellContext missing')
  return value
}
