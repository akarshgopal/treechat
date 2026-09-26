import {
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { useThreadChat } from '@/lib/thread-run-registry'
import { BranchHeader, MainHeader } from '@/components/chat/LaneHeader'
import { type LaneFrame } from '@/components/chat/Lanes'
import { ThreadView } from '@/components/chat/ThreadView'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { MAX_ATTACHMENTS, prepareFiles } from '@/lib/attachments/prepare'
import { addDocumentFiles } from '@/lib/documents/library'
import { loadModelCapabilities, modelReadsImages } from '@/lib/model-capabilities'
import {
  doomedIdsForAnchors,
  dropAnchorIdsForEdit,
  droppedMessageIds,
  editUserMessage,
  retryFromAssistant,
  retryFromUser,
} from '@/lib/message-actions'
import { fromUIMessages, toUIMessages } from '@/lib/messages'
import {
  OPENROUTER_MODEL_OPTIONS,
  shortModelName,
} from '@/lib/provider'
import { useTree } from '@/store/tree-store'
import type { Attachment, ChatMessage, ProviderStatus } from '@/types'

import { useShell } from '@/components/chat/shell-context'

/**
 * Warn before an image goes to a model that can't read it, with a one-click
 * switch. Only with a key (OpenRouter's list says which models read images);
 * unknown models get no warning.
 */
function useVisionNotice(files: Attachment[], status: ProviderStatus, onSwitch: (model: string) => void): ReactNode {
  const hasImage = files.some((file) => file.kind === 'image')
  const live = status.mode === 'live' && status.provider === 'openrouter'
  const [, setLoaded] = useState(0)
  useEffect(() => {
    if (!hasImage || !live) return
    let cancelled = false
    void loadModelCapabilities().then(() => {
      if (!cancelled) setLoaded((count) => count + 1)
    })
    return () => {
      cancelled = true
    }
  }, [hasImage, live])
  if (!hasImage || !live || modelReadsImages(status.model) !== false) return null
  const alternative = OPENROUTER_MODEL_OPTIONS.find((option) => modelReadsImages(option.id) === true)
  return (
    <span className="text-amber-300/90" data-testid="vision-warning">
      {shortModelName(status.model)} can’t read images.{' '}
      {alternative ? (
        <button type="button" className="font-medium text-branch-bright underline underline-offset-2" onClick={() => onSwitch(alternative.id)}>
          Switch to {alternative.label}
        </button>
      ) : 'Pick a model that reads images in Settings.'}
    </span>
  )
}

type PendingRewrite = {
  lostMessages: number
  lostBranches: number
  verb: string
  apply: () => void
  resolve: (confirmed: boolean) => void
}

/**
 * A thread's lane: its transcript, composer and actions. The conversation
 * itself runs in `ThreadRunners`, so closing the lane never cuts a reply off.
 */
export function ThreadLane({ threadId, openChildId, frame }: { threadId: string; openChildId: string | null; frame: LaneFrame }) {
  const { state, rewriteThread, setWebSearch, activeSession, setSessionDocuments } = useTree()
  const shell = useShell()
  const thread = state.threads[threadId]
  const chat = useThreadChat(shell.sessionId, threadId)

  const [pendingRewrite, setPendingRewrite] = useState<PendingRewrite | null>(null)
  const [attachBusy, setAttachBusy] = useState(false)
  const [attachProblem, setAttachProblem] = useState<string | null>(null)
  const pendingFiles = shell.attachmentsFor(threadId)
  const visionNotice = useVisionNotice(pendingFiles, shell.status, shell.onSwitchModel)

  if (!thread || !chat) return null

  const snapshot = () => {
    const live = fromUIMessages(chat.messages)
    return live.length > 0 ? live : thread.messages
  }

  const send = () => {
    const text = shell.draftFor(threadId).trim()
    const attachments = shell.attachmentsFor(threadId)
    if (!text && attachments.length === 0) return
    shell.setDraft(threadId, '')
    shell.setAttachments(threadId, () => [])
    setAttachProblem(null)
    // The object form carries attachments as metadata (the bytes stay in
    // IndexedDB) and, unlike a bare string, allows a message with no text.
    void chat.sendMessage(attachments.length > 0 ? { content: text, metadata: { attachments } } : text)
  }

  const addFiles = async (files: File[]) => {
    const current = shell.attachmentsFor(threadId)
    setAttachBusy(true)
    try {
      const prepared = await prepareFiles(files, MAX_ATTACHMENTS - current.length)
      if (prepared.attachments.length > 0) {
        shell.setAttachments(threadId, (existing) => [...existing, ...prepared.attachments])
      }
      const problems = [...prepared.errors]
      if (prepared.documents.length > 0) {
        // PDFs are too big to resend with every turn; they join this chat's Documents.
        const ids = addDocumentFiles(prepared.documents)
        if (ids.length > 0) setSessionDocuments(activeSession.id, [...(activeSession.documentIds ?? []), ...ids])
        problems.push(`${prepared.documents.map((file) => file.name).join(', ')} added to this chat’s Documents — searched, not sent whole.`)
      }
      setAttachProblem(problems.length > 0 ? problems.join(' ') : null)
    } finally {
      setAttachBusy(false)
    }
  }

  /**
   * Apply a rewrite now if it only replaces the reply being regenerated.
   * Anything more (later turns, branches anchored below) asks first.
   * Resolves false when the person keeps the conversation as it is.
   */
  const rewrite = (
    next: ChatMessage[] | null,
    before: ChatMessage[],
    anchorIds: string[],
    replacedId: string | undefined,
    verb: string,
  ): Promise<boolean> => {
    if (!next) return Promise.resolve(false)
    const dropped = droppedMessageIds(before, next)
    const lostMessages = dropped.filter((id) => id !== replacedId).length
    const lostBranches = doomedIdsForAnchors(state, threadId, anchorIds).length
    const apply = () => {
      if (chat.isLoading) chat.stop()
      chat.setMessages(toUIMessages(next))
      rewriteThread(threadId, next, anchorIds)
      void chat.reload()
    }
    if (lostMessages === 0 && lostBranches === 0) {
      apply()
      return Promise.resolve(true)
    }
    return new Promise((resolve) => {
      setPendingRewrite({ lostMessages, lostBranches, verb, apply, resolve })
    })
  }

  /** The reply that directly answers a user turn, if any — it is being replaced anyway. */
  const replyAfter = (messages: ChatMessage[], messageId: string) => {
    const index = messages.findIndex((message) => message.id === messageId)
    const reply = messages[index + 1]
    return reply?.role === 'assistant' && reply.kind !== 'drop-summary' ? reply.id : undefined
  }

  const retryAssistant = (messageId: string) => {
    const before = snapshot()
    const next = retryFromAssistant(before, messageId)
    void rewrite(next, before, next ? droppedMessageIds(before, next) : [], messageId, 'Regenerate')
  }

  const editUser = (messageId: string, content: string) => {
    const before = snapshot()
    const next = editUserMessage(before, messageId, content)
    return rewrite(next, before, next ? dropAnchorIdsForEdit(before, next, messageId) : [], replyAfter(before, messageId), 'Edit & resend')
  }

  const regenerateUser = (messageId: string) => {
    const before = snapshot()
    const next = retryFromUser(before, messageId)
    void rewrite(next, before, next ? droppedMessageIds(before, next) : [], replyAfter(before, messageId), 'Regenerate')
  }

  const closeRewrite = (confirmed: boolean) => {
    if (!pendingRewrite) return
    if (confirmed) pendingRewrite.apply()
    pendingRewrite.resolve(confirmed)
    setPendingRewrite(null)
  }

  return (
    <>
    <ThreadView
      thread={thread}
      state={state}
      openChildId={openChildId}
      scrollPositions={shell.scrollPositions}
      scrollKey={`${shell.sessionId}:${threadId}`}
      error={chat.error?.message}
      onRetryError={() => { void chat.reload() }}
      onShowDemo={shell.onShowDemo}
      blankNote={shell.narrow && shell.status.mode === 'mock' ? 'Replies are demo text until you add an OpenRouter key in Settings.' : undefined}
      onAskMessage={shell.onAskMessage}
      leadOffset={frame.leadOffset}
      openCitation={shell.openSource?.threadId === threadId ? shell.openSource : null}
      onOpenCitation={shell.onOpenSource}
      header={thread.parentId ? (
        <BranchHeader
          thread={thread}
          onMerge={() => shell.onMerge(threadId)}
          onDiscard={() => shell.onDiscard(threadId)}
          onReturn={() => shell.onReturn(threadId)}
          onCollapse={frame.onCollapse}
          summarized={Object.values(state.threads).some((entry) => entry.messages.some((message) => message.sourceThreadId === threadId))}
        />
      ) : shell.narrow ? undefined : (
        <MainHeader
          title={activeSession.title}
          onRename={shell.onRenameChat}
          onDelete={shell.onDeleteChat}
          onCollapse={frame.onCollapse}
        />
      )}
      draft={shell.draftFor(threadId)}
      onDraftChange={(value) => shell.setDraft(threadId, value)}
      composerAttach={{
        items: pendingFiles,
        busy: attachBusy,
        onAdd: (files) => void addFiles(files),
        onRemove: (id) => shell.setAttachments(threadId, (current) => current.filter((item) => item.id !== id)),
      }}
      composerNotice={attachProblem || visionNotice ? (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {attachProblem ? <span data-testid="attach-problem">{attachProblem}</span> : null}
          {visionNotice}
        </span>
      ) : undefined}
      composerWebSearch={{
        on: Boolean(thread.webSearch),
        paid: shell.status.mode === 'live',
        onToggle: () => {
          if (!thread.webSearch) shell.onWebSearchOn()
          setWebSearch(threadId, !thread.webSearch)
        },
      }}
      onSend={send}
      onStop={() => chat.stop()}
      isLoading={chat.isLoading}
      onSelectMessage={shell.onSelectMessage}
      onOpenChild={shell.onOpenChild}
      onFocusChild={shell.onFocus}
      onRetryAssistant={retryAssistant}
      onRegenerateUser={regenerateUser}
      onEditUser={editUser}
      composerRef={(el) => shell.registerComposer(threadId, el)}
      accentComposer={Boolean(thread.anchor)}
      placeholder={
        thread.anchor
          ? 'Ask in this branch…'
          : thread.messages.length === 0
            ? 'Ask anything…'
            : 'Reply…'
      }
      emptyLabel={
        thread.anchor
          ? 'Ask a follow-up…'
          : undefined
      }
    />
    {/* Mounted only while pending: reopening a closing Radix dialog can
        strand its overlay on top of the new one. */}
    {pendingRewrite ? (
    <AlertDialog open onOpenChange={(open) => { if (!open) closeRewrite(false) }}>
      <AlertDialogContent data-testid="rewrite-confirm">
        <AlertDialogHeader>
          <AlertDialogTitle>Rewrite the conversation from here?</AlertDialogTitle>
          <AlertDialogDescription>
            {rewriteLoss(pendingRewrite.lostMessages, pendingRewrite.lostBranches)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep conversation</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="rewrite-confirm-action"
            onClick={() => closeRewrite(true)}
          >
            {pendingRewrite.verb}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    ) : null}
    </>
  )
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}

function rewriteLoss(messages: number, branches: number) {
  const parts = [
    messages > 0 ? plural(messages, 'later message', 'later messages') : '',
    branches > 0 ? plural(branches, 'branch', 'branches') : '',
  ].filter(Boolean)
  return `This removes ${parts.join(' and ')} in this conversation. This cannot be undone.`
}
