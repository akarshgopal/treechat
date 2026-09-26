import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '@tanstack/ai-react'
import { chatConnection } from '@/lib/chat-connection'
import { takeRunCitations } from '@/lib/citations'
import { fromUIMessages, sameTranscript, toUIMessages } from '@/lib/messages'
import { refreshSummary } from '@/lib/summarize'
import { branchForwardedProps, pathTo } from '@/lib/tree'
import { hasQuestion, parseKey, publishChat, runKey, setBusy, takeQuestion, useRunningKeys } from '@/lib/thread-run-registry'
import { takeRunUsage } from '@/lib/usage'
import { useTree } from '@/store/tree-store'

/**
 * Each thread's conversation runs here, apart from the lane that shows it:
 * a reply keeps streaming, and is saved to its chat, after its branch is
 * closed or another chat is opened. A runner exists while its thread is on
 * screen or still answering; lanes read it through `useThreadChat`.
 */

/**
 * One runner per thread on the open chat's lane path, plus any thread (in any
 * chat) whose reply is still streaming or whose first question is waiting.
 * Keyed on `rev`, so an external write (a takeaway) restarts the runner on the
 * new transcript, as lanes did.
 */
export function ThreadRunners({ epoch }: { epoch: number }) {
  const { sessions, activeSessionId, state } = useTree()
  const running = useRunningKeys()
  const wanted = new Map<string, { sessionId: string; threadId: string }>()
  for (const thread of pathTo(state, state.activeThreadId)) wanted.set(runKey(activeSessionId, thread.id), { sessionId: activeSessionId, threadId: thread.id })
  for (const key of running) wanted.set(key, parseKey(key))
  return [...wanted.values()].map(({ sessionId, threadId }) => {
    const rev = sessions.find((session) => session.id === sessionId)?.treeState.threads[threadId]?.rev
    if (rev === undefined) return null
    return <ThreadRunner key={`${runKey(sessionId, threadId)}:${rev}:${epoch}`} sessionId={sessionId} threadId={threadId} />
  })
}

function ThreadRunner({ sessionId, threadId }: { sessionId: string; threadId: string }) {
  const { sessions, replaceMessages, setSummary } = useTree()
  const session = sessions.find((entry) => entry.id === sessionId)
  const state = session?.treeState
  const thread = state?.threads[threadId]
  const key = runKey(sessionId, threadId)

  const [initialMessages] = useState(() => toUIMessages(thread?.messages ?? []))
  const summary = thread?.summary
  const anchorAttachments = thread?.anchor && thread.parentId
    ? state?.threads[thread.parentId]?.messages.find((message) => message.id === thread.anchor!.messageId)?.attachments
    : undefined
  const chat = useChat({
    threadId,
    connection: chatConnection,
    initialMessages,
    forwardedProps: {
      ...(state ? branchForwardedProps(state, threadId) : {}),
      cacheSessionId: sessionId,
      // The transport retrieves excerpts from these documents before sending.
      documentIds: session?.documentIds ?? [],
      ...(thread?.webSearch ? { webSearch: true } : {}),
      ...(summary ? { threadSummary: { content: summary.content, throughMessageId: summary.throughMessageId } } : {}),
      // A branch from a message with images shows the model those images too.
      ...(anchorAttachments ? { anchorAttachments } : {}),
    },
  })

  // Lanes render from this; publishing in a layout effect updates them in the
  // same frame.
  useLayoutEffect(() => publishChat(key, chat))
  useLayoutEffect(() => () => publishChat(key, null), [key])

  const { sendMessage } = chat
  /** Sent, but the engine has not reported loading yet: still busy. */
  const sending = useRef(false)
  useEffect(() => {
    // StrictMode detaches and reattaches useChat during its mount replay.
    // Sending in that first effect starts a request that detach immediately
    // aborts. Consume the pending question only after the mount has settled.
    const timer = window.setTimeout(() => {
      // Busy first, so the runner stays mounted from the moment it sends.
      if (!hasQuestion(key)) return
      sending.current = true
      setBusy(key, true)
      const question = takeQuestion(key)
      if (question) void sendMessage(question)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [key, sendMessage])

  const saved = useMemo(() => thread?.messages ?? [], [thread])
  useEffect(() => {
    const next = fromUIMessages(chat.messages)
    if (next.length === 0 && saved.length > 0) return
    if (!sameTranscript(next, saved)) replaceMessages(threadId, next, sessionId)
  }, [chat.messages, replaceMessages, saved, sessionId, threadId])

  // When a reply finishes: attach its sources and usage, save that at once
  // (the runner may unmount right after if its lane is closed), and refresh
  // the thread's summary off the reply's path.
  const wasLoading = useRef(false)
  const { setMessages } = chat
  useEffect(() => {
    if (chat.isLoading || chat.error) sending.current = false
    const finished = wasLoading.current && !chat.isLoading
    wasLoading.current = chat.isLoading
    if (finished) {
      if (!chat.error) void refreshSummary(threadId, fromUIMessages(chat.messages), summary, (next, basis) => setSummary(threadId, next, basis, sessionId))
      const citations = takeRunCitations(threadId)
      const usage = takeRunUsage(threadId)
      const last = chat.messages.at(-1)
      if ((citations || usage) && last?.role === 'assistant') {
        const messages = chat.messages.map((message) =>
          message === last
            ? { ...message, metadata: { ...(message.metadata ?? {}), ...(citations ? { citations } : {}), ...(usage ? { usage } : {}) } }
            : message,
        )
        setMessages(messages)
        replaceMessages(threadId, fromUIMessages(messages), sessionId)
      }
    }
    setBusy(key, chat.isLoading || sending.current)
  }, [chat.error, chat.isLoading, chat.messages, key, replaceMessages, sessionId, setMessages, setSummary, summary, threadId])

  useEffect(() => () => setBusy(key, false), [key])

  return null
}
