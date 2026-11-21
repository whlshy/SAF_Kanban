// When a task was created, as the board shows it.
//
// Boards kept on this computer store UTC ISO times ("2026-11-21T02:30:00.000Z"),
// shown in this computer's time zone. The Apps Script (v3 and later) writes
// the Sheet's own local time ("2026-11-21 10:30:00"), shown as written, like
// the deletion times in the history sheet. Tasks from before either have none.

const pad = (n) => String(n).padStart(2, "0")

const WRITTEN = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/
const HAS_ZONE = /(?:[zZ]|[+-]\d{2}:?\d{2})$/

// { year, month, day, full: "2026-11-21 10:30" }, or null without a time.
// Text that isn't a date is kept as written, without the parts.
export function createdAtParts(value) {
  const text = String(value ?? "").trim()
  if (!text) return null

  let parts
  if (HAS_ZONE.test(text) && !Number.isNaN(Date.parse(text))) {
    const date = new Date(text)
    parts = [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes()]
  } else {
    const written = text.match(WRITTEN)
    if (!written) return { full: text }
    parts = written.slice(1).map((part) => (part === undefined ? null : Number(part)))
  }
  const [year, month, day, hour, minute] = parts
  const date = `${year}-${pad(month)}-${pad(day)}`
  return { year, month, day, full: hour === null ? date : `${date} ${pad(hour)}:${pad(minute)}` }
}

// A Sheet time ("2026-11-21 10:30:00", the Sheet's local time) as a UTC ISO
// time for a board kept on this computer, taking this computer's time zone
// for the Sheet's. "" when there is no usable time.
export function sheetTimeToIso(value) {
  const parts = createdAtParts(value)
  if (!parts?.year) return ""
  const written = String(value).trim().match(/[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/)
  const [hour, minute, second] = written ? written.slice(1).map((part) => Number(part ?? 0)) : [0, 0, 0]
  const date = new Date(parts.year, parts.month - 1, parts.day, hour, minute, second)
  return Number.isNaN(date.getTime()) ? "" : date.toISOString()
}
