import { createId } from '../ids.ts'
import { cropBox, regionQuote } from '../anchors.ts'
import type { AnchorRegion, Attachment } from '@/types'
import { getAttachment, putAttachment } from './store.ts'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not read the image.'))
    image.src = src
  })
}

/**
 * Cut a region out of a stored image and store it as an image of its own,
 * so the branch can send just that part. Resolves to its attachment record.
 */
export async function cropRegion(region: Pick<AnchorRegion, 'attachmentId' | 'name' | 'x' | 'y' | 'w' | 'h'>): Promise<Attachment> {
  const stored = await getAttachment(region.attachmentId)
  if (!stored?.data.startsWith('data:image/')) throw new Error('That image is no longer available.')
  const image = await loadImage(stored.data)
  const box = cropBox(region, image.naturalWidth, image.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = box.width
  canvas.height = box.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser could not crop the image.')
  context.drawImage(image, box.left, box.top, box.width, box.height, 0, 0, box.width, box.height)
  // PNG keeps small crops of text sharp; they are small anyway.
  const data = canvas.toDataURL('image/png')
  const id = createId('attachment')
  await putAttachment({ id, data, createdAt: Date.now(), description: regionQuote(region.name) })
  return { id, kind: 'image', name: `Region of ${region.name}`, mime: 'image/png', size: Math.round((data.length * 3) / 4), width: box.width, height: box.height }
}
