import assert from 'node:assert/strict'
import test from 'node:test'
import { surroundingText } from './anchors.ts'

test('surrounding text is bounded and cut at word edges', () => {
  const source = `${'alpha '.repeat(200)}THE PASSAGE${' omega'.repeat(200)}`
  const start = source.indexOf('THE PASSAGE')
  const around = surroundingText(source, start, start + 11, 60)
  assert.ok(around.startsWith('…alpha') && around.endsWith('omega…'))
  assert.ok(around.includes('THE PASSAGE'))
  assert.ok(around.length < 150)
  assert.equal(surroundingText('short text', 0, 5), 'short text')
})
