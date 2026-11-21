import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createdAtParts, sheetTimeToIso } from './createdAt.js'

const pad = (n) => String(n).padStart(2, "0")

test('a time written by the Apps Script is shown as written', () => {
  assert.deepEqual(createdAtParts("2026-11-21 10:30:00"), { year: 2026, month: 11, day: 21, full: "2026-11-21 10:30" })
  assert.deepEqual(createdAtParts("2026/1/5 09:07"), { year: 2026, month: 1, day: 5, full: "2026-01-05 09:07" })
  assert.deepEqual(createdAtParts("2026-11-21"), { year: 2026, month: 11, day: 21, full: "2026-11-21" })
})

test('a UTC time from a local board is shown in this computer\'s time zone', () => {
  const iso = "2026-11-21T02:30:00.000Z"
  const local = new Date(iso)
  const expected = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())} ${pad(local.getHours())}:${pad(local.getMinutes())}`
  assert.equal(createdAtParts(iso).full, expected)
})

test('no time, or text that is not a date', () => {
  assert.equal(createdAtParts(""), null)
  assert.equal(createdAtParts(undefined), null)
  assert.deepEqual(createdAtParts("last week"), { full: "last week" })
})

test('a Sheet time becomes a UTC time for a local board', () => {
  const iso = sheetTimeToIso("2026-11-21 10:30:15")
  const back = new Date(iso)
  assert.deepEqual(
    [back.getFullYear(), back.getMonth() + 1, back.getDate(), back.getHours(), back.getMinutes(), back.getSeconds()],
    [2026, 11, 21, 10, 30, 15],
  )
  assert.ok(iso.endsWith("Z"))
  assert.equal(sheetTimeToIso(""), "")
  assert.equal(sheetTimeToIso("soon"), "")
})
