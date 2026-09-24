import { getAttachment, putAttachment, type StoredAttachment } from './attachments/store.ts'
import { parseSession } from './storage.ts'
import type { ChatSession } from '@/types'

/** Marks a TreeChat export, so an unrelated JSON file is refused clearly. */
export const EXPORT_FORMAT = 'treechat-export'
export const EXPORT_VERSION = 1

export type ExportFile = {
  format: typeof EXPORT_FORMAT
  version: number
  exportedAt: string
  sessions: ChatSession[]
  /** Pasted images and attached files, so an import shows them again. */
  attachments: StoredAttachment[]
}

export type ImportedChats = { sessions: ChatSession[]; attachments: StoredAttachment[] }

function attachmentIds(sessions: ChatSession[]): string[] {
  const ids = new Set<string>()
  for (const session of sessions) {
    for (const thread of Object.values(session.treeState.threads)) {
      for (const message of thread.messages) for (const file of message.attachments ?? []) ids.add(file.id)
    }
  }
  return [...ids]
}

/** Everything needed to rebuild these chats elsewhere. Documents are not included. */
export async function buildExport(sessions: ChatSession[], now = new Date()): Promise<ExportFile> {
  const attachments: StoredAttachment[] = []
  for (const id of attachmentIds(sessions)) {
    // A missing file (cleared storage, private window) just stays missing.
    const stored = await getAttachment(id).catch(() => undefined)
    if (stored) attachments.push(stored)
  }
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: now.toISOString(), sessions, attachments }
}

export function exportFileName(now = new Date()): string {
  return `treechat-chats-${now.toISOString().slice(0, 10)}.json`
}

/** Save a JSON file through the browser's download. */
export function downloadJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export async function exportChats(sessions: ChatSession[]) {
  downloadJson(exportFileName(), await buildExport(sessions))
}

function parseStoredAttachment(value: unknown): StoredAttachment | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || typeof record.data !== 'string') return null
  return {
    id: record.id,
    data: record.data,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
    ...(typeof record.description === 'string' ? { description: record.description } : {}),
  }
}

/**
 * Read an export (or a raw copy of the stored library, which has the same
 * `sessions`). Throws an Error whose message can be shown as is.
 */
export function parseImport(text: string): ImportedChats {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  if (!record || !Array.isArray(record.sessions)) throw new Error('That file is not a TreeChat export.')
  if (record.format === EXPORT_FORMAT && typeof record.version === 'number' && record.version > EXPORT_VERSION) {
    throw new Error('That export comes from a newer TreeChat. Reload to update, then try again.')
  }
  const sessions = record.sessions.flatMap((entry) => parseSession(entry) ?? [])
  if (sessions.length === 0) throw new Error('No chats could be read from that file.')
  const attachments = Array.isArray(record.attachments) ? record.attachments.flatMap((entry) => parseStoredAttachment(entry) ?? []) : []
  return { sessions, attachments }
}

/** Store an import's files; chats are merged by the session reducer. */
export async function storeImportedAttachments(attachments: StoredAttachment[]) {
  for (const file of attachments) {
    const existing = await getAttachment(file.id).catch(() => undefined)
    if (!existing) await putAttachment(file).catch(() => undefined)
  }
}
