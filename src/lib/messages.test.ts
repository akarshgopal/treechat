import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatMessage } from '@/types'
import { withoutEmptyReply } from './messages.ts'

const message = (role: 'user' | 'assistant', content: string, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id: `${role}-${content}`, role, content, createdAt: 0, kind: 'message', ...extra })

test('a reply that never got text is dropped, everything else is kept', () => {
  const asked = [message('user', 'hi')]
  assert.deepEqual(withoutEmptyReply([...asked, message('assistant', '')]), asked)
  assert.deepEqual(withoutEmptyReply([...asked, message('assistant', '  \n')]), asked)

  const answered = [...asked, message('assistant', 'hello')]
  assert.equal(withoutEmptyReply(answered), answered)
  assert.equal(withoutEmptyReply(asked), asked)
  // Only the last message counts: an empty one earlier is not this run's.
  const earlier = [message('assistant', ''), message('user', 'again')]
  assert.equal(withoutEmptyReply(earlier), earlier)
  // A takeaway or a reply carrying files is not empty.
  const takeaway = [...asked, message('assistant', '', { kind: 'drop-summary' })]
  assert.equal(withoutEmptyReply(takeaway), takeaway)
  const withFile = [...asked, message('assistant', '', { attachments: [{ id: 'a', kind: 'text', name: 'n', mime: 'text/plain', size: 1 } as never] })]
  assert.equal(withoutEmptyReply(withFile), withFile)
})
