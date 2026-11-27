import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatLabels,
  hashLabelColor,
  labelOptions,
  normalizeLabelDefs,
  parseLabels,
  resolveLabelStyle,
} from './labels.js'

test('parseLabels trims, splits commas, and deduplicates case-insensitively', () => {
  assert.deepEqual(parseLabels(' bug, Frontend , BUG, , ui '), ['bug', 'Frontend', 'ui'])
  assert.deepEqual(parseLabels(['bug, docs', 'DOCS', '']), ['bug', 'docs'])
  assert.equal(formatLabels(['bug', 'frontend']), 'bug, frontend')
})

test('normalizeLabelDefs preserves valid palette keys and hex colors', () => {
  assert.deepEqual(
    normalizeLabelDefs([
      { name: ' bug ', color: 'RED' },
      { name: 'custom', color: '#3b82f6' },
      { name: 'bad-color', color: 'neon' },
      { name: 'BUG', color: 'blue' },
      { name: '  ', color: 'green' },
    ]),
    [
      { name: 'bug', color: 'red' },
      { name: 'custom', color: '#3b82f6' },
      { name: 'bad-color' },
    ]
  )
})

test('resolveLabelStyle prefers board definition, supports hex, and falls back to stable hash', () => {
  const defs = [
    { name: 'bug', color: 'red' },
    { name: 'brand', color: '#3b82f6' },
  ]
  const bugDark = resolveLabelStyle('BUG', defs, true)
  assert.equal(bugDark.dot, '#ef4444')

  const brandLight = resolveLabelStyle('brand', defs, false)
  assert.equal(brandLight.dot, '#3b82f6')
  assert.ok(brandLight.backgroundColor.startsWith('rgba(59, 130, 246,'))

  const hash1 = hashLabelColor('freeform-tag')
  const hash2 = hashLabelColor('FREEFORM-TAG')
  assert.equal(hash1, hash2)
  assert.notEqual(hash1, 'gray')
})

test('labelOptions lists board labels first then freeform labels from tasks', () => {
  const defs = [{ name: 'bug', color: 'red' }, { name: 'docs', color: 'gray' }]
  const tasks = [
    { labels: ['frontend', 'BUG'] },
    { labels: ['cli', 'Frontend'] },
  ]
  assert.deepEqual(labelOptions(defs, tasks), ['bug', 'docs', 'frontend', 'cli'])
})
