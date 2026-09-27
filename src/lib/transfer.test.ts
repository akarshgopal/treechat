import assert from 'node:assert/strict'
import test from 'node:test'
import { createSeedState } from './seed.ts'
import { EXPORT_FORMAT, parseImport } from './transfer.ts'

const chat = { id: 's1', title: 'Demo', createdAt: 1, updatedAt: 2, titleLocked: true, treeState: createSeedState() }

test('unreadable, foreign and newer files are refused with a message to show', () => {
  assert.throws(() => parseImport('{nope'), /not valid JSON/)
  assert.throws(() => parseImport('{"hello":1}'), /not a TreeChat export/)
  assert.throws(() => parseImport(JSON.stringify({ format: EXPORT_FORMAT, version: 99, sessions: [chat] })), /newer TreeChat/)
  assert.throws(() => parseImport(JSON.stringify({ sessions: [{ id: 'x' }] })), /No chats/)
})
