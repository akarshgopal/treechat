import assert from 'node:assert/strict'
import test from 'node:test'
import { branchShortcutLabel, isApplePlatform, sendShortcutLabel } from './utils.ts'

test('isApplePlatform matches macOS and iOS platform strings', () => {
  assert.equal(isApplePlatform('MacIntel'), true)
  assert.equal(isApplePlatform('macOS'), true)
  assert.equal(isApplePlatform('iPhone'), true)
  assert.equal(isApplePlatform('iPad'), true)
  assert.equal(isApplePlatform('Win32'), false)
  assert.equal(isApplePlatform('Linux x86_64'), false)
  assert.equal(isApplePlatform('Windows'), false)
})

test('sendShortcutLabel is ⌘⏎ on Apple and Ctrl+Enter elsewhere', () => {
  assert.equal(sendShortcutLabel('MacIntel'), '⌘⏎')
  assert.equal(sendShortcutLabel('macOS'), '⌘⏎')
  assert.equal(sendShortcutLabel('Win32'), 'Ctrl+Enter')
  assert.equal(sendShortcutLabel('Linux x86_64'), 'Ctrl+Enter')
})

test('branchShortcutLabel stays platform-correct', () => {
  assert.equal(branchShortcutLabel('MacIntel'), '⌘⇧B')
  assert.equal(branchShortcutLabel('Win32'), 'Ctrl+⇧B')
})
