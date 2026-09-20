import assert from 'node:assert/strict'
import test from 'node:test'
import { EventType } from '@tanstack/ai'
import { mockChatStream, textFromMessage } from './mock-stream.ts'

test('textFromMessage reads string content and text parts', () => {
  assert.equal(textFromMessage({ role: 'user', content: 'hello' }), 'hello')
  assert.equal(
    textFromMessage({
      role: 'user',
      parts: [{ type: 'text', content: 'from parts' }],
    }),
    'from parts',
  )
})

test('mockChatStream emits TanStack text events without a server', async () => {
  const chunks = []
  for await (const chunk of mockChatStream({
    messages: [{ role: 'user', content: 'hello there' }],
    threadId: 't1',
    runId: 'r1',
    pace: false,
  })) {
    chunks.push(chunk)
  }
  assert.equal(chunks[0]?.type, EventType.RUN_STARTED)
  assert.ok(chunks.some((chunk) => chunk.type === EventType.TEXT_MESSAGE_CONTENT))
  const text = chunks
    .filter((chunk) => chunk.type === EventType.TEXT_MESSAGE_CONTENT)
    .map((chunk) => ('delta' in chunk ? chunk.delta : ''))
    .join('')
  assert.match(text, /lands in whichever thread/)
  assert.equal(chunks.at(-1)?.type, EventType.RUN_FINISHED)
})
