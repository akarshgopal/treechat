import assert from 'node:assert/strict'
import test from 'node:test'
import {
  backgroundModelFor,
  DEFAULT_OPENROUTER_MODEL,
  parseProviderConfig,
  serializeProviderConfig,
} from './provider.ts'

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

test('the background model is used only with a key and when it differs', () => {
  const base = { provider: 'openrouter' as const, apiKey: 'k', model: 'openai/gpt-4.1-mini' }
  assert.equal(backgroundModelFor(null), undefined)
  assert.equal(backgroundModelFor(base), undefined)
  assert.equal(backgroundModelFor({ ...base, backgroundModel: 'openai/gpt-4.1-nano' }), 'openai/gpt-4.1-nano')
  assert.equal(backgroundModelFor({ ...base, backgroundModel: base.model }), undefined)
  assert.equal(backgroundModelFor({ ...base, apiKey: '', backgroundModel: 'openai/gpt-4.1-nano' }), undefined)
})
