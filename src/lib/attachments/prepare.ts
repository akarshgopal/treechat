import { createId } from '../ids.ts'
import type { Attachment } from '@/types'
import { putAttachment } from './store.ts'

/**
 * Long edge after resizing. Vision models downscale larger images anyway, so
 * sending more only costs tokens and upload time; text in screenshots stays
 * legible at this size.
 */
export const MAX_IMAGE_EDGE = 1568
export const MAX_ATTACHMENTS = 8
/** Refuse absurd inputs before decoding them. */
export const MAX_INPUT_BYTES = 25 * 1024 * 1024
/** Text files are sent whole; past this they belong in Documents. */
export const MAX_TEXT_CHARS = 60_000

const TEXT_TYPES = /^(text\/|application\/(json|xml|x-yaml|yaml|javascript|typescript|x-sh|sql|csv|toml))/
const TEXT_EXTENSIONS = /\.(txt|md|markdown|mdx|csv|tsv|json|jsonl|ya?ml|toml|xml|html?|css|js|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|sh|zsh|sql|log|ini|env|tex|rst|org)$/i

export type AttachmentKind = 'image' | 'text' | 'document' | 'unsupported'

/** What a dropped or pasted file becomes. PDFs go to Documents. */
export function classifyFile(file: Pick<File, 'name' | 'type'>): AttachmentKind {
  if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') return 'image'
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'document'
  if (TEXT_TYPES.test(file.type) || TEXT_EXTENSIONS.test(file.name)) return 'text'
  return 'unsupported'
}

/** Scale `width × height` so the long edge is at most `max`, keeping aspect. */
export function fitWithin(width: number, height: number, max = MAX_IMAGE_EDGE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** Screenshots pasted from the clipboard arrive as "image.png"; name them usefully. */
export function attachmentName(file: Pick<File, 'name' | 'type'>, now = new Date()): string {
  if (file.name && file.name !== 'image.png' && file.name !== 'image') return file.name
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}.${String(now.getMinutes()).padStart(2, '0')}`
  return `Screenshot ${stamp}.${file.type.split('/')[1] ?? 'png'}`
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image.'))
    reader.readAsDataURL(blob)
  })
}

async function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  const toBlob = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
  // WebP is smallest; browsers that cannot encode it hand back PNG instead.
  const webp = await toBlob('image/webp', 0.86)
  if (webp?.type === 'image/webp') return webp
  const jpeg = await toBlob('image/jpeg', 0.88)
  if (jpeg) return jpeg
  throw new Error('This browser could not re-encode the image.')
}

async function prepareImage(file: File): Promise<{ attachment: Attachment; data: string }> {
  const bitmap = await createImageBitmap(file)
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser could not draw the image.')
    // Transparent screenshots would turn black as JPEG; paint a white page first.
    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
    context.drawImage(bitmap, 0, 0, width, height)
    const blob = await encode(canvas)
    const data = await readAsDataUrl(blob)
    return {
      data,
      attachment: { id: createId('att'), kind: 'image', name: attachmentName(file), mime: blob.type, size: blob.size, width, height },
    }
  } finally {
    bitmap.close()
  }
}

async function prepareText(file: File): Promise<{ attachment: Attachment; data: string }> {
  const text = await file.text()
  if (text.length > MAX_TEXT_CHARS) {
    throw new Error(`${file.name} is too long to send with a message — add it to Documents instead.`)
  }
  return {
    data: text,
    attachment: { id: createId('att'), kind: 'text', name: file.name || 'file.txt', mime: file.type || 'text/plain', size: new Blob([text]).size },
  }
}

export type PreparedFiles = {
  attachments: Attachment[]
  /** Files meant for the Documents library (PDFs). */
  documents: File[]
  errors: string[]
}

/**
 * Turn picked, pasted or dropped files into stored attachments, in order.
 * One bad file never loses the others; each failure becomes a message.
 */
export async function prepareFiles(files: File[], room = MAX_ATTACHMENTS): Promise<PreparedFiles> {
  const result: PreparedFiles = { attachments: [], documents: [], errors: [] }
  for (const file of files) {
    const kind = classifyFile(file)
    if (kind === 'document') {
      result.documents.push(file)
      continue
    }
    if (kind === 'unsupported') {
      result.errors.push(`${file.name || 'That file'} can't be attached — images and text files only.`)
      continue
    }
    if (result.attachments.length >= room) {
      result.errors.push(`Up to ${MAX_ATTACHMENTS} attachments per message.`)
      break
    }
    if (file.size > MAX_INPUT_BYTES) {
      result.errors.push(`${file.name} is larger than 25 MB.`)
      continue
    }
    try {
      const { attachment, data } = kind === 'image' ? await prepareImage(file) : await prepareText(file)
      await putAttachment({ id: attachment.id, data, createdAt: Date.now() })
      result.attachments.push(attachment)
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : `${file.name} could not be attached.`)
    }
  }
  return result
}
