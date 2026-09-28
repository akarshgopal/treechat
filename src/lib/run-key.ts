/**
 * What a thread's run hands over when it finishes (sources, cost, earlier
 * answers, a model override) is keyed by chat and thread: every chat's main
 * thread has the same id, so the thread alone would mix chats up.
 */
export const runKeyOf = (sessionId: string, threadId: string) => `${sessionId}\u0000${threadId}`

/** The key for a request: by chat when it belongs to one (`cacheSessionId`), else by thread. */
export function runKeyForRequest(threadId: string, forwardedProps?: Record<string, unknown>): string {
  const sessionId = forwardedProps?.cacheSessionId
  return typeof sessionId === 'string' && sessionId ? runKeyOf(sessionId, threadId) : threadId
}
