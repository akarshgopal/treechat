import type { Attachment } from '@/types'
import { collectAssistantText, runChat } from '../client-chat.ts'
import { modelReadsImages } from '../model-capabilities.ts'
import { backgroundModelFor, loadProviderConfig } from '../provider.ts'
import { getAttachment, setAttachmentDescription } from './store.ts'

export const DESCRIBE_PROMPT =
  'Describe this image for someone who cannot see it, in 1–3 sentences. Transcribe short visible text (headings, labels, error messages) exactly; for code or long text, say what it is and quote the key lines. No preamble.'

const started = new Set<string>()

/** The background model when it can read images, else the main model (which just did). */
function describerModel(): string | undefined {
  const background = backgroundModelFor(loadProviderConfig())
  return background && modelReadsImages(background) === true ? background : undefined
}

/**
 * Write a short description for each image once, in the background. Older
 * turns and summaries use it in place of the image. Failures are silent: the
 * image is then named without a description.
 */
export function describeImagesInBackground(images: Attachment[]) {
  for (const image of images) {
    if (image.kind !== 'image' || started.has(image.id)) continue
    started.add(image.id)
    void describe(image).catch(() => undefined)
  }
}

async function describe(image: Attachment) {
  const stored = await getAttachment(image.id)
  if (!stored || stored.description) return
  const text = await collectAssistantText(runChat({
    messages: [{ id: 'describe', role: 'user', parts: [{ type: 'text', content: DESCRIBE_PROMPT }], metadata: { attachments: [image] } }],
    // `describing` keeps this request from asking for descriptions itself.
    forwardedProps: { describing: true },
    threadId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    model: describerModel(),
  }))
  if (text.trim()) await setAttachmentDescription(image.id, text.trim())
}
