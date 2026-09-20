import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import {
  DEFAULT_OPENROUTER_MODEL,
  bearerToken,
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

test('no key and no env is mock', () => {
  const status = resolveProvider()
  assert.equal(status.mode, 'mock')
  assert.equal(status.provider, 'mock')
  assert.equal(status.apiKey, null)
})

test('Authorization Bearer selects OpenRouter over env xAI', () => {
  const status = resolveProvider(
    requestWith({
      Authorization: 'Bearer sk-or-v1-client',
      'X-TreeChat-Model': 'anthropic/claude-sonnet-4',
    }),
    { XAI_API_KEY: 'should-not-win', OPENROUTER_API_KEY: 'env-or' },
  )
  assert.equal(status.mode, 'live')
  assert.equal(status.provider, 'openrouter')
  assert.equal(status.apiKey, 'sk-or-v1-client')
  assert.equal(status.model, 'anthropic/claude-sonnet-4')
})

test('Bearer without model uses the OpenRouter default', () => {
  const status = resolveProvider(
    requestWith({ Authorization: 'Bearer sk-or-v1-client' }),
  )
  assert.equal(status.model, DEFAULT_OPENROUTER_MODEL)
})

test('empty Bearer is ignored', () => {
  const status = resolveProvider(
    requestWith({ Authorization: 'Bearer   ' }),
    { OPENROUTER_API_KEY: 'env-or' },
  )
  assert.equal(status.provider, 'openrouter')
  assert.equal(status.apiKey, 'env-or')
})

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

test('bearerToken reads the Authorization header', () => {
  assert.equal(
    bearerToken(requestWith({ Authorization: 'bearer  abc  ' })),
    'abc',
  )
  assert.equal(bearerToken(requestWith({})), undefined)
})

test('process.env is the local-dev fallback when env map omits keys', () => {
  process.env.OPENROUTER_API_KEY = 'from-process'
  process.env.OPENROUTER_MODEL = 'openai/gpt-4.1'
  const status = resolveProvider()
  assert.equal(status.provider, 'openrouter')
  assert.equal(status.apiKey, 'from-process')
  assert.equal(status.model, 'openai/gpt-4.1')
})
