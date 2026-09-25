import { useMemo, useSyncExternalStore } from 'react'
import type { useChat } from '@tanstack/ai-react'

/**
 * Which threads have a live conversation, and their chat engines, shared by
 * the runners that own them (`ThreadRunners`) and the lanes that show them.
 */

export type ThreadChat = ReturnType<typeof useChat>

export const runKey = (sessionId: string, threadId: string) => `${sessionId}\u0000${threadId}`
export const parseKey = (key: string) => {
  const [sessionId = '', threadId = ''] = key.split('\u0000')
  return { sessionId, threadId }
}

const chats = new Map<string, ThreadChat>()
let busy: ReadonlySet<string> = new Set()
/** A question waiting for a new branch's runner to mount and send it. */
let questions: ReadonlyMap<string, string> = new Map()
const listeners = new Set<() => void>()
const notify = () => { for (const listener of listeners) listener() }
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setBusy(key: string, on: boolean) {
  if (busy.has(key) === on) return
  const next = new Set(busy)
  if (on) next.add(key)
  else next.delete(key)
  busy = next
  notify()
}

/** The live conversation of a thread, or null until its runner has mounted. */
export function useThreadChat(sessionId: string, threadId: string): ThreadChat | null {
  const key = runKey(sessionId, threadId)
  return useSyncExternalStore(subscribe, () => chats.get(key) ?? null)
}

/** Threads of this chat with a reply streaming in. */
export function useBusyThreads(sessionId: string): ReadonlySet<string> {
  const all = useSyncExternalStore(subscribe, () => busy)
  return useMemo(() => new Set([...all].map(parseKey).filter((run) => run.sessionId === sessionId).map((run) => run.threadId)), [all, sessionId])
}

/** Ask a new branch's first question once its runner is ready. */
export function queueQuestion(sessionId: string, threadId: string, question: string) {
  questions = new Map(questions).set(runKey(sessionId, threadId), question)
  notify()
}

export function takeQuestion(key: string): string | undefined {
  const question = questions.get(key)
  if (question === undefined) return undefined
  const next = new Map(questions)
  next.delete(key)
  questions = next
  notify()
  return question
}

export function stopThread(sessionId: string, threadId: string) {
  chats.get(runKey(sessionId, threadId))?.stop()
}

/** Stop every reply streaming in this chat; true when one was. */
export function stopChat(sessionId: string): boolean {
  let stopped = false
  for (const key of busy) {
    if (parseKey(key).sessionId !== sessionId) continue
    chats.get(key)?.stop()
    stopped = true
  }
  return stopped
}

/** For the runners: publish or withdraw a thread's live engine. */
export function publishChat(key: string, chat: ThreadChat | null) {
  if ((chats.get(key) ?? null) === chat) return
  if (chat) chats.set(key, chat)
  else chats.delete(key)
  notify()
}

export const hasQuestion = (key: string) => questions.has(key)

/** Threads that need a runner beyond those on screen: busy, or with a question waiting. */
export function useRunningKeys(): string[] {
  const running = useSyncExternalStore(subscribe, () => busy)
  const waiting = useSyncExternalStore(subscribe, () => questions)
  return useMemo(() => [...new Set([...running, ...waiting.keys()])], [running, waiting])
}
