import assert from 'node:assert/strict'
import test from 'node:test'
import { OFFSET_IGNORE_ATTR, splitMarkedText, type Mark } from './selection.ts'

const mark = (id: string, start: number, end: number, open = false): Mark => ({
  id,
  start,
  end,
  open,
})

test('plain text when there are no marks', () => {
  assert.deepEqual(splitMarkedText('hello', []), [{ text: 'hello' }])
})

test('splits around a single mark', () => {
  const segments = splitMarkedText('one two three', [mark('a', 4, 7)])
  assert.deepEqual(
    segments.map((s) => s.text),
    ['one ', 'two', ' three'],
  )
  assert.deepEqual(segments[1].marks?.map((m) => m.id), ['a'])
})

test('groups every branch hanging off the exact same span', () => {
  const segments = splitMarkedText('one two three', [
    mark('a', 4, 7),
    mark('b', 4, 7),
    mark('c', 4, 7),
  ])
  assert.equal(segments.length, 3)
  assert.deepEqual(segments[1].marks?.map((m) => m.id), ['a', 'b', 'c'])
})

test('keeps non-overlapping marks separate', () => {
  const segments = splitMarkedText('one two three', [
    mark('a', 0, 3),
    mark('b', 8, 13),
  ])
  assert.deepEqual(
    segments.filter((s) => s.marks).map((s) => s.marks![0].id),
    ['a', 'b'],
  )
})

test('a merely-overlapping mark loses to the first one', () => {
  const segments = splitMarkedText('one two three', [
    mark('a', 0, 7),
    mark('b', 4, 13),
  ])
  assert.deepEqual(
    segments.filter((s) => s.marks).map((s) => s.marks!.map((m) => m.id)),
    [['a']],
  )
})

test('drops marks that fall outside the content', () => {
  assert.deepEqual(splitMarkedText('short', [mark('a', 2, 99)]), [
    { text: 'short' },
  ])
})

test('offset-ignore attribute is the chrome skip hook', () => {
  assert.equal(OFFSET_IGNORE_ATTR, 'data-offset-ignore')
})
