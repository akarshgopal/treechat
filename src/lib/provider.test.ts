import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_OPENROUTER_MODEL,
  TREECHAT_MODEL_HEADER,
  parseProviderConfig,
  providerRequestHeaders,
} from './provider.ts'

test('parseProviderConfig rejects missing or empty keys', () => {
  assert.equal(parseProviderConfig(null), null)
  assert.equal(parseProviderConfig('{'), null)
  assert.equal(parseProviderConfig('{"apiKey":"  "}'), null)
  assert.equal(parseProviderConfig('{"model":"openai/gpt-4.1-mini"}'), null)
})

test('parseProviderConfig reads OpenRouter key and model', () => {
  const config = parseProviderConfig(
    JSON.stringify({
      provider: 'openrouter',
      apiKey: ' sk-or-v1-test ',
      model: ' openai/gpt-4.1-mini ',
    }),
  )
  assert.deepEqual(config, {
    provider: 'openrouter',
    apiKey: 'sk-or-v1-test',
    model: 'openai/gpt-4.1-mini',
  })
})

test('parseProviderConfig defaults the model', () => {
  const config = parseProviderConfig(JSON.stringify({ apiKey: 'abc' }))
  assert.equal(config?.model, DEFAULT_OPENROUTER_MODEL)
})

test('providerRequestHeaders is empty without a key', () => {
  assert.deepEqual(providerRequestHeaders(null), {})
})

test('providerRequestHeaders attaches Bearer and model', () => {
  const headers = providerRequestHeaders({
    provider: 'openrouter',
    apiKey: 'sk-or-v1-test',
    model: 'anthropic/claude-sonnet-4',
  })
  assert.equal(headers.Authorization, 'Bearer sk-or-v1-test')
  assert.equal(headers[TREECHAT_MODEL_HEADER], 'anthropic/claude-sonnet-4')
})
