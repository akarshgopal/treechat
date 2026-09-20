import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { handleApiRequest } from './chat.ts'

const KEYS = [
  'XAI_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
] as const
const prev = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]))

beforeEach(() => {
  for (const key of KEYS) delete process.env[key]
})

after(() => {
  for (const key of KEYS) {
    const value = prev[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

test('GET /api/status is mock without a key', async () => {
  const response = await handleApiRequest(
    new Request('http://treechat.test/api/status'),
    {},
  )
  assert.equal(response.status, 200)
  const body = (await response.json()) as { mode: string; provider: string }
  assert.equal(body.mode, 'mock')
  assert.equal(body.provider, 'mock')
})

test('GET /api/status uses the per-request OpenRouter key', async () => {
  const response = await handleApiRequest(
    new Request('http://treechat.test/api/status', {
      headers: {
        Authorization: 'Bearer sk-or-v1-client',
        'X-TreeChat-Model': 'openai/gpt-4.1-mini',
      },
    }),
    { XAI_API_KEY: 'should-not-win' },
  )
  const body = (await response.json()) as {
    mode: string
    provider: string
    model: string
    apiKey?: string
  }
  assert.equal(body.mode, 'live')
  assert.equal(body.provider, 'openrouter')
  assert.equal(body.model, 'openai/gpt-4.1-mini')
  assert.equal(body.apiKey, undefined)
})
