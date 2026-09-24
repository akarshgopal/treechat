import assert from 'node:assert/strict'
import test from 'node:test'
import { createEmptyState } from './seed.ts'
import {
  MAX_SESSIONS,
  capSessions,
} from './sessions.ts'
import type { ChatSession } from '../types.ts'

function session(id: string, updatedAt: number): ChatSession {
  return {
    id,
    title: id,
    createdAt: updatedAt,
    updatedAt,
    treeState: createEmptyState(),
    titleLocked: false,
  }
}

test('capSessions drops the oldest chats and never the kept id', () => {
  const sessions = Array.from({ length: MAX_SESSIONS + 3 }, (_, i) => session(`s${i}`, i))
  const next = capSessions(sessions, 's0')
  assert.equal(next.length, MAX_SESSIONS)
  assert.ok(next.some((item) => item.id === 's0'))
  assert.ok(!next.some((item) => item.id === 's1'))
  assert.ok(next.some((item) => item.id === `s${MAX_SESSIONS + 2}`))
})
