import assert from 'node:assert/strict'
import test from 'node:test'
import {
  backgroundModelFor,
  chatCompletionsUrl,
  DEFAULT_OPENROUTER_MODEL,
  formatHeaderLines,
  isLiveConfig,
  isModelIdFor,
  parseBaseUrl,
  parseExtraBody,
  parseHeaderLines,
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

test('a custom server config round-trips, and OpenRouter configs stay as they were', () => {
  const custom = parseProviderConfig(serializeProviderConfig({
    provider: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1/',
    apiKey: '',
    model: 'llama3.2:3b',
    headers: { 'api-key': 'x' },
    extraBody: { top_p: 0.9 },
  }))
  assert.deepEqual(custom, {
    provider: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    apiKey: '',
    model: 'llama3.2:3b',
    headers: { 'api-key': 'x' },
    extraBody: { top_p: 0.9 },
  })

  // A config saved before providers existed has no `provider` field.
  const legacy = parseProviderConfig(JSON.stringify({ apiKey: 'k', model: 'openai/gpt-4.1' }))
  assert.equal(legacy?.provider, 'openrouter')
  // Server fields never leak into an OpenRouter config.
  const stray = parseProviderConfig(JSON.stringify({ provider: 'openrouter', apiKey: 'k', baseUrl: 'https://evil.example' }))
  assert.equal(stray?.baseUrl, undefined)
})

test('isLiveConfig needs a key for OpenRouter and a URL for a custom server', () => {
  const openRouter = { provider: 'openrouter' as const, apiKey: '', model: 'a/b' }
  assert.equal(isLiveConfig(null), false)
  assert.equal(isLiveConfig(openRouter), false)
  assert.equal(isLiveConfig({ ...openRouter, apiKey: 'k' }), true)
  const custom = { provider: 'openai-compatible' as const, apiKey: '', model: 'm' }
  assert.equal(isLiveConfig(custom), false)
  assert.equal(isLiveConfig({ ...custom, baseUrl: 'http://localhost:1234/v1' }), true)
  assert.equal(backgroundModelFor({ ...custom, baseUrl: 'http://localhost:1234/v1', backgroundModel: 'small' }), 'small')
})

test('base URLs are limited to http(s) and lose trailing slashes, queries and credentials', () => {
  assert.equal(parseBaseUrl(' https://api.openai.com/v1/ '), 'https://api.openai.com/v1')
  assert.equal(parseBaseUrl('http://localhost:11434'), 'http://localhost:11434')
  assert.equal(parseBaseUrl('https://gw.example/v1?key=1#x'), 'https://gw.example/v1')
  for (const bad of ['', 'localhost:11434/v1', 'ftp://x.example', 'javascript:alert(1)', 'https://user:pw@x.example/v1', 42]) {
    assert.equal(parseBaseUrl(bad), undefined, String(bad))
  }
  assert.equal(chatCompletionsUrl('https://api.openai.com/v1'), 'https://api.openai.com/v1/chat/completions')
  assert.equal(chatCompletionsUrl('https://gw.example/chat/completions'), 'https://gw.example/chat/completions')
})

test('custom model ids are free-form, OpenRouter ids stay vendor/model', () => {
  assert.equal(isModelIdFor('openai-compatible', 'gpt-4.1'), true)
  assert.equal(isModelIdFor('openai-compatible', 'llama3.2:3b'), true)
  assert.equal(isModelIdFor('openai-compatible', 'two words'), false)
  assert.equal(isModelIdFor('openai-compatible', ' '), false)
  assert.equal(isModelIdFor('openrouter', 'gpt-4.1'), false)
  assert.equal(isModelIdFor('openrouter', 'openai/gpt-4.1'), true)
})

test('header lines and extra-body JSON parse strictly', () => {
  assert.deepEqual(parseHeaderLines('api-key: abc\n\nX-Team: a: b'), { 'api-key': 'abc', 'X-Team': 'a: b' })
  assert.deepEqual(parseHeaderLines(''), {})
  for (const bad of ['no colon', ': value', 'bad name: v', 'name:']) assert.equal(parseHeaderLines(bad), undefined, bad)
  assert.equal(formatHeaderLines({ a: '1', b: '2' }), 'a: 1\nb: 2')

  assert.equal(parseExtraBody('  '), null)
  assert.deepEqual(parseExtraBody('{"top_p":0.9}'), { top_p: 0.9 })
  for (const bad of ['[1]', '"x"', '{oops', '3']) assert.equal(parseExtraBody(bad), undefined, bad)
})
