import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveViteBase } from './vite-base.ts'

test('local default is root', () => {
  assert.equal(resolveViteBase({}), '/')
})

test('GITHUB_REPOSITORY treechat becomes /treechat/', () => {
  assert.equal(
    resolveViteBase({ GITHUB_REPOSITORY: 'akarshgopal/treechat' }),
    '/treechat/',
  )
})

test('VITE_BASE overrides the repository name', () => {
  assert.equal(
    resolveViteBase({
      VITE_BASE: '/',
      GITHUB_REPOSITORY: 'akarshgopal/treechat',
    }),
    '/',
  )
  assert.equal(resolveViteBase({ VITE_BASE: '/treechat' }), '/treechat/')
})
