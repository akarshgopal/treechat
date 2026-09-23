import assert from 'node:assert/strict'
import test from 'node:test'
import { extractFile, extractMarkdown, extractPlainText, formatOf } from './extract.ts'

test('formatOf recognizes PDFs, Markdown, and text; rejects the rest', () => {
  assert.equal(formatOf('paper.PDF'), 'pdf')
  assert.equal(formatOf('blob', 'application/pdf'), 'pdf')
  assert.equal(formatOf('notes.md'), 'markdown')
  assert.equal(formatOf('notes', 'text/markdown'), 'markdown')
  assert.equal(formatOf('log.txt'), 'text')
  assert.equal(formatOf('data', 'text/csv'), 'text')
  assert.equal(formatOf('photo.png', 'image/png'), null)
})

test('plain text becomes one block with normalized line endings', () => {
  const doc = extractPlainText('﻿line one\r\nline two\r\n\r\n')
  assert.deepEqual(doc, { format: 'text', blocks: [{ text: 'line one\nline two' }] })
  assert.deepEqual(extractPlainText('   \n').blocks, [])
})

test('markdown splits on headings and remembers the heading of each section', () => {
  const doc = extractMarkdown([
    '---',
    'title: skipped',
    '---',
    'Preamble text.',
    '',
    '# Install',
    'Run the installer.',
    '',
    '```sh',
    '# a comment, not a heading',
    '```',
    '## Configure ##',
    'Edit the file.',
  ].join('\n'))
  assert.equal(doc.format, 'markdown')
  assert.deepEqual(doc.blocks.map((block) => block.heading), [undefined, 'Install', 'Configure'])
  assert.equal(doc.blocks[0]!.text, 'Preamble text.')
  assert.match(doc.blocks[1]!.text, /^# Install\nRun the installer\./)
  assert.match(doc.blocks[1]!.text, /# a comment, not a heading/)
  assert.doesNotMatch(doc.blocks[0]!.text, /title: skipped/)
})

test('extractFile routes by file type and refuses unsupported files', async () => {
  const md = new File(['# Title\n\nBody'], 'a.md', { type: 'text/markdown' })
  assert.equal((await extractFile(md)).blocks[0]!.heading, 'Title')
  const txt = new File(['hello'], 'a.txt', { type: 'text/plain' })
  assert.deepEqual((await extractFile(txt)).blocks, [{ text: 'hello' }])
  await assert.rejects(extractFile(new File(['x'], 'a.png', { type: 'image/png' })), /Only PDF, Markdown, and text/)
})
