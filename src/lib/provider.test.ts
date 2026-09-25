import assert from 'node:assert/strict'
import test from 'node:test'
import {
  backgroundModelFor,
  isModelId,
  DEFAULT_OPENROUTER_MODEL,
  loadProviderConfig,
  normalizeProviderConfig,
  parseProviderConfig,
  saveProviderConfig,
  serializeProviderConfig,
} from './provider.ts'
import { installLocalStorage } from '../test-support/local-storage.ts'

test('parseProviderConfig rejects missing or invalid payloads', () => {
  assert.equal(parseProviderConfig(null), null)
  assert.equal(parseProviderConfig('{'), null)
  assert.equal(parseProviderConfig('[]'), null)
  assert.equal(parseProviderConfig('"nope"'), null)
})

test('parseProviderConfig clamps temperature and drops invalid maxTokens', () => {
  const high = parseProviderConfig(
    JSON.stringify({ apiKey: 'k', temperature: 9, maxTokens: -3 }),
  )
  assert.equal(high?.temperature, 2)
  assert.equal(high?.maxTokens, undefined)

  const low = parseProviderConfig(
    JSON.stringify({ apiKey: 'k', temperature: -1, maxTokens: 0 }),
  )
  assert.equal(low?.temperature, 0)
  assert.equal(low?.maxTokens, undefined)

  const strings = parseProviderConfig(
    JSON.stringify({ apiKey: 'k', temperature: '1.25', maxTokens: '2048' }),
  )
  assert.equal(strings?.temperature, 1.25)
  assert.equal(strings?.maxTokens, 2048)
})

test('serializeProviderConfig roundtrips and omits empty optionals', () => {
  const full = {
    provider: 'openrouter' as const,
    apiKey: ' sk-or-v1-test ',
    model: ' google/gemini-2.5-flash ',
    temperature: 1.5,
    maxTokens: 1024,
  }
  const raw = serializeProviderConfig(full)
  assert.deepEqual(JSON.parse(raw), {
    provider: 'openrouter',
    apiKey: 'sk-or-v1-test',
    model: 'google/gemini-2.5-flash',
    temperature: 1.5,
    maxTokens: 1024,
  })
  assert.deepEqual(parseProviderConfig(raw), normalizeProviderConfig(full))

  const bare = serializeProviderConfig({
    provider: 'openrouter',
    apiKey: '',
    model: DEFAULT_OPENROUTER_MODEL,
  })
  assert.deepEqual(JSON.parse(bare), {
    provider: 'openrouter',
    apiKey: '',
    model: DEFAULT_OPENROUTER_MODEL,
  })
  assert.ok(!('temperature' in JSON.parse(bare)))
  assert.ok(!('maxTokens' in JSON.parse(bare)))
})

test('serializeProviderConfig keeps temperature 0', () => {
  const raw = serializeProviderConfig({
    provider: 'openrouter',
    apiKey: 'k',
    model: DEFAULT_OPENROUTER_MODEL,
    temperature: 0,
  })
  assert.equal(JSON.parse(raw).temperature, 0)
  assert.equal(parseProviderConfig(raw)?.temperature, 0)
})

test('saveProviderConfig persists params without an API key', () => {
  installLocalStorage()
  saveProviderConfig({
    provider: 'openrouter',
    apiKey: '',
    model: 'google/gemini-2.5-flash',
    temperature: 1.1,
  })
  assert.deepEqual(loadProviderConfig(), {
    provider: 'openrouter',
    apiKey: '',
    model: 'google/gemini-2.5-flash',
    temperature: 1.1,
  })
})

test('isModelId accepts vendor/model ids and rejects partial text', () => {
  assert.equal(isModelId('openai/gpt-4.1-mini'), true)
  assert.equal(isModelId('nvidia/nemotron-3-ultra-550b-a55b:free'), true)
  assert.equal(isModelId(' anthropic/claude-sonnet-4 '), true)
  assert.equal(isModelId('anthro'), false)
  assert.equal(isModelId('openai/'), false)
  assert.equal(isModelId('/gpt'), false)
  assert.equal(isModelId('open ai/gpt'), false)
})

test('the background model is used only with a key and when it differs', () => {
  const base = { provider: 'openrouter' as const, apiKey: 'k', model: 'openai/gpt-4.1-mini' }
  assert.equal(backgroundModelFor(null), undefined)
  assert.equal(backgroundModelFor(base), undefined)
  assert.equal(backgroundModelFor({ ...base, backgroundModel: 'openai/gpt-4.1-nano' }), 'openai/gpt-4.1-nano')
  assert.equal(backgroundModelFor({ ...base, backgroundModel: base.model }), undefined)
  assert.equal(backgroundModelFor({ ...base, apiKey: '', backgroundModel: 'openai/gpt-4.1-nano' }), undefined)
})
