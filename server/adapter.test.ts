import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import {
  getProviderStatus,
  resolveProvider,
} from './adapter.ts'

const KEYS = [
  'XAI_API_KEY',
  'XAI_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
] as const

const prev = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]))

function clearProcessEnv() {
  for (const key of KEYS) delete process.env[key]
}

beforeEach(() => {
  clearProcessEnv()
})

after(() => {
  clearProcessEnv()
  for (const key of KEYS) {
    const value = prev[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function requestWith(headers: Record<string, string>) {
  return new Request('http://treechat.test/api/chat', { headers })
}

test('env fallback order is xAI, OpenAI, OpenRouter', () => {
  assert.equal(
    resolveProvider(null, { OPENAI_API_KEY: 'o', OPENROUTER_API_KEY: 'r' })
      .provider,
    'openai',
  )
  assert.equal(
    resolveProvider(null, {
      XAI_API_KEY: 'x',
      OPENAI_API_KEY: 'o',
      OPENROUTER_API_KEY: 'r',
    }).provider,
    'xai',
  )
  assert.equal(
    resolveProvider(null, { OPENROUTER_API_KEY: 'r' }).provider,
    'openrouter',
  )
})

test('getProviderStatus never includes the key', () => {
  const status = getProviderStatus(
    requestWith({ Authorization: 'Bearer secret-key' }),
  )
  assert.equal(status.provider, 'openrouter')
  assert.equal(status.mode, 'live')
  assert.equal('apiKey' in status, false)
})
