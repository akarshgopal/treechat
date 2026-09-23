import assert from 'node:assert/strict'
import test from 'node:test'
import type { Attachment } from '../../types.ts'
import { toOpenAIChatMessages } from '../client-chat.ts'
import { parseVisionModels } from '../model-capabilities.ts'
import { attachmentLabel, parseAttachments, sameAttachments } from './parse.ts'
import { attachmentName, classifyFile, fitWithin } from './prepare.ts'
import { RESEND_RECENT_MESSAGES, prepareRequestMessages } from './request.ts'
import type { StoredAttachment } from './store.ts'
import { mockChatStream } from '../../../shared/mock-stream.ts'

const shot: Attachment = { id: 'a1', kind: 'image', name: 'shot.png', mime: 'image/webp', size: 1000, width: 1280, height: 720 }
const notes: Attachment = { id: 'a2', kind: 'text', name: 'notes.txt', mime: 'text/plain', size: 12 }
const files: Record<string, StoredAttachment> = {
  a1: { id: 'a1', data: 'data:image/webp;base64,AAA', createdAt: 1 },
  a2: { id: 'a2', data: 'remember this', createdAt: 1 },
  old: { id: 'old', data: 'data:image/webp;base64,OLD', createdAt: 1, description: 'A red error dialog saying "Disk full".' },
}
const load = async (id: string) => files[id]
const user = (id: string, text: string, attachments?: Attachment[]) => ({
  id, role: 'user', parts: [{ type: 'text', content: text }], ...(attachments ? { metadata: { attachments } } : {}),
})
const assistant = (id: string, text: string) => ({ id, role: 'assistant', parts: [{ type: 'text', content: text }] })

test('attachment records parse strictly and compare by id', () => {
  assert.deepEqual(parseAttachments([shot, notes, { ...shot }, { id: 'x', kind: 'video', name: 'v', mime: 'v', size: 1 }]), [shot, notes])
  assert.equal(parseAttachments('nope'), undefined)
  assert.equal(sameAttachments([shot], [{ ...shot, name: 'renamed' }]), true)
  assert.equal(sameAttachments([shot], undefined), false)
  assert.equal(attachmentLabel(shot), 'shot.png · 1280×720')
})

test('files are sorted into images, text, documents and the rest', () => {
  assert.equal(classifyFile({ name: 'a.png', type: 'image/png' }), 'image')
  assert.equal(classifyFile({ name: 'logo.svg', type: 'image/svg+xml' }), 'unsupported')
  assert.equal(classifyFile({ name: 'report.pdf', type: 'application/pdf' }), 'document')
  assert.equal(classifyFile({ name: 'main.rs', type: '' }), 'text')
  assert.equal(classifyFile({ name: 'data.json', type: 'application/json' }), 'text')
  assert.equal(classifyFile({ name: 'song.mp3', type: 'audio/mpeg' }), 'unsupported')
})

test('images shrink to the long-edge limit and pasted screenshots get a name', () => {
  assert.deepEqual(fitWithin(3136, 1568), { width: 1568, height: 784 })
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 })
  assert.deepEqual(fitWithin(1000, 4000, 1000), { width: 250, height: 1000 })
  assert.equal(attachmentName({ name: 'image.png', type: 'image/png' }, new Date(2026, 8, 23, 9, 5)), 'Screenshot 2026-09-23 09.05.png')
  assert.equal(attachmentName({ name: 'diagram.jpg', type: 'image/jpeg' }), 'diagram.jpg')
})

test('recent images are sent inline, text files are quoted, older images are named', async () => {
  const messages = [
    user('m0', 'Look at this', [{ ...shot, id: 'old', name: 'old.png' }]),
    ...Array.from({ length: RESEND_RECENT_MESSAGES }, (_, i) => (i % 2 ? user(`u${i}`, 'more') : assistant(`r${i}`, 'ok'))),
    user('m9', 'And now these', [shot, notes]),
  ]
  const { messages: out, sentImages } = await prepareRequestMessages(messages, { imagesInline: true, load })
  assert.deepEqual(out[0]!.requestImages, undefined)
  assert.match(out[0]!.parts[0]!.content, /\[Image: old\.png · 1280×720 — A red error dialog saying "Disk full"\.\]/)
  const last = out.at(-1)!
  assert.deepEqual(last.requestImages, [{ url: 'data:image/webp;base64,AAA', label: 'shot.png · 1280×720' }])
  assert.match(last.parts[0]!.content, /^And now these\n\nAttached file notes\.txt:\n```\nremember this\n```$/)
  assert.deepEqual(sentImages.map((image) => image.id), ['a1'])
})

test('text-only backends get images by name, and a branch inherits its source images', async () => {
  const textOnly = await prepareRequestMessages([user('m1', 'What is this?', [shot])], { imagesInline: false, load })
  assert.equal(textOnly.messages[0]!.requestImages, undefined)
  assert.match(textOnly.messages[0]!.parts[0]!.content, /\[Image: shot\.png · 1280×720 — this model only reads text\]/)

  const branch = await prepareRequestMessages(
    [user('b1', 'Explain the error'), assistant('b2', 'It is…'), user('b3', 'why?')],
    { imagesInline: true, load, anchorAttachments: [{ ...shot, id: 'old', name: 'old.png' }] },
  )
  assert.deepEqual(branch.messages[0]!.requestImages?.map((image) => image.url), ['data:image/webp;base64,OLD'])
  assert.equal(branch.messages[2]!.requestImages, undefined)
})

test('a missing file is named rather than failing the request', async () => {
  const { messages } = await prepareRequestMessages([user('m1', 'hi', [{ ...shot, id: 'gone' }])], { imagesInline: true, load })
  assert.match(messages[0]!.parts[0]!.content, /\[Image: shot\.png — no longer available\]/)
})

test('OpenRouter user turns with images become content parts', () => {
  const [plain, withImage] = toOpenAIChatMessages([
    { role: 'assistant', parts: [{ type: 'text', content: 'hello' }] },
    { role: 'user', parts: [{ type: 'text', content: 'see' }], requestImages: [{ url: 'data:image/webp;base64,AAA', label: 'x' }] },
  ])
  assert.deepEqual(plain, { role: 'assistant', content: 'hello' })
  assert.deepEqual(withImage, { role: 'user', content: [{ type: 'text', text: 'see' }, { type: 'image_url', image_url: { url: 'data:image/webp;base64,AAA' } }] })
})

test('the model list marks which models read images, in either shape', () => {
  const { vision, known } = parseVisionModels({ data: [
    { id: 'openai/gpt-4.1-mini', architecture: { input_modalities: ['text', 'image'] } },
    { id: 'meta-llama/llama-3.3-70b-instruct:free', architecture: { input_modalities: ['text'] } },
    { id: 'old/vision', architecture: { modality: 'text+image->text' } },
    { id: 'old/text', architecture: { modality: 'text->text' } },
    { nope: true },
  ] })
  assert.deepEqual(vision, ['openai/gpt-4.1-mini', 'old/vision'])
  assert.equal(known.length, 4)
  assert.deepEqual(parseVisionModels(null), { vision: [], known: [] })
})

test('the demo reply acknowledges what was attached', async () => {
  let text = ''
  for await (const chunk of mockChatStream({
    messages: [{ role: 'user', content: 'Hi\n\n[Image: shot.png · 1280×720 — this model only reads text]\n\nAttached file notes.txt:\n```\nx\n```' }],
    threadId: 't', runId: 'r', pace: false,
  })) if (chunk.type === 'TEXT_MESSAGE_CONTENT') text += chunk.delta
  assert.match(text, /I received 1 image \(shot\.png · 1280×720\) and 1 file \(notes\.txt\)/)
})
