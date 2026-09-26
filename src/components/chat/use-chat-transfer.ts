import { useCallback, useRef } from 'react'
import type { ToastState } from '@/components/chat/Toast'
import { createId } from '@/lib/ids'
import { exportChats, parseImport, storeImportedAttachments } from '@/lib/transfer'
import type { ChatSession } from '@/types'

/** Export every chat to a file, or add the chats from one, saying how it went. */
export function useChatTransfer(
  sessions: ChatSession[],
  importSessions: (sessions: ChatSession[]) => void,
  onToast: (toast: ToastState | null) => void,
) {
  const onExport = useCallback(() => {
    void exportChats(sessions).catch(() => onToast({ id: createId('toast'), text: 'Could not export your chats.', actions: [] }))
  }, [onToast, sessions])

  /** A hidden file input the command palette opens. */
  const importInput = useRef<HTMLInputElement>(null)
  const onImport = useCallback(async (file: File) => {
    try {
      const imported = parseImport(await file.text())
      await storeImportedAttachments(imported.attachments)
      // Mirrors the reducer: an identical chat already here is skipped.
      const count = imported.sessions.filter((session) =>
        !sessions.some((existing) => existing.id === session.id && existing.updatedAt === session.updatedAt)).length
      importSessions(imported.sessions)
      onToast({
        id: createId('toast'),
        text: count === 0 ? 'Those chats are already here.' : `Imported ${count} ${count === 1 ? 'chat' : 'chats'}`,
        actions: [],
      })
    } catch (error) {
      onToast({ id: createId('toast'), text: error instanceof Error ? error.message : 'Could not import that file.', actions: [] })
    }
  }, [importSessions, onToast, sessions])

  return { onExport, onImport, importInput }
}
