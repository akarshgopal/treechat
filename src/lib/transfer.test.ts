import assert from 'node:assert/strict'
import test from 'node:test'
import { createSeedState } from './seed.ts'
import { EXPORT_FORMAT, parseImport } from './transfer.ts'

const chat = { id: 's1', title: 'Demo', createdAt: 1, updatedAt: 2, titleLocked: true, treeState: createSeedState() }

test('an export reads back its chats and files, dropping what cannot be used', () => {
  const file = {
    format: EXPORT_FORMAT,
    version: 1,
    sessions: [chat, { id: 'broken' }],
    attachments: [{ id: 'att-1', data: 'data:image/png;base64,AA', createdAt: 3 }, { id: 'no-data' }],
  }
  const imported = parseImport(JSON.stringify(file))
  assert.deepEqual(imported.sessions.map((session) => session.id), ['s1'])
  assert.deepEqual(imported.attachments.map((item) => item.id), ['att-1'])
})

test('unreadable, foreign and newer files are refused with a message to show', () => {
  assert.throws(() => parseImport('{nope'), /not valid JSON/)
  assert.throws(() => parseImport('{"hello":1}'), /not a TreeChat export/)
  assert.throws(() => parseImport(JSON.stringify({ format: EXPORT_FORMAT, version: 99, sessions: [chat] })), /newer TreeChat/)
  assert.throws(() => parseImport(JSON.stringify({ sessions: [{ id: 'x' }] })), /No chats/)
})
