import { useTree } from '@/store/tree-store'

/** The active chat's attached documents, and a way to change them. */
export function useChatDocuments() {
  const { activeSession, setSessionDocuments } = useTree()
  const attached = activeSession.documentIds ?? []
  return {
    attached,
    setAttached: (ids: string[]) => setSessionDocuments(activeSession.id, ids),
    attach: (ids: string[]) => setSessionDocuments(activeSession.id, [...attached, ...ids]),
  }
}
