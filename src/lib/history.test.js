import test from 'node:test'
import assert from 'node:assert/strict'
import { filterHistory, parseHistory } from './history.js'

test('deleted tasks are listed newest first, with the time as the Sheet shows it', () => {
  const records = parseHistory([
    ['a', 'Older', '', '', 'Todo', 'low', 'Amy', 45000.5],
    ['b', 'Newer', 'SAF-2', 'notes', 'Done', 'high', '', '2026-11-05 09:30:00'],
    ['c', 'No time', '', '', 'Todo', '', '', ''],
    [],
  ])
  assert.deepEqual(records.map((r) => r.id), ['b', 'a', 'c'])
  assert.equal(records[0].deletedAt, '2026-11-05 09:30')
  assert.equal(records[1].deletedAt, '2023-03-15 12:00')
  assert.equal(records[0].issueId, 'SAF-2')
})

test('the history search matches every word in any field', () => {
  const records = parseHistory([
    ['a', 'Fix login', '', '', 'Todo', 'low', 'Amy', 45000],
    ['b', 'Fix logout', '', '', 'Done', 'low', 'Ben', 45001],
  ])
  assert.deepEqual(filterHistory(records, 'fix').map((r) => r.id), ['b', 'a'])
  assert.deepEqual(filterHistory(records, 'fix amy').map((r) => r.id), ['a'])
  assert.deepEqual(filterHistory(records, 'done').map((r) => r.id), ['b'])
  assert.equal(filterHistory(records, '  ').length, 2)
})
