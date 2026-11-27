import { matchesTerms, searchTerms } from './search.js'
import { parseLabels } from './labels.js'

// Helpers for the history sheet: one deleted task per row, columns A:G as in
// the kanban sheet, H the deletion time, I creation time (Apps Script v3+),
// J last column-move time (v4+), and K labels (v6+).

// Google Sheets date serials count days from 1899-12-30; 25569 is 1970-01-01.
const SERIAL_UNIX_EPOCH = 25569
const MS_PER_DAY = 86400000

// The time is the Sheet's local wall-clock time without a time zone, so it is
// kept as a serial and formatted in UTC, i.e. exactly as the Sheet shows it.
const toSerial = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  const match = String(value ?? "").trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (!match) return null
  const [y, mo, d, h, mi, s] = match.slice(1).map((part) => Number(part ?? 0))
  return Date.UTC(y, mo - 1, d, h, mi, s) / MS_PER_DAY + SERIAL_UNIX_EPOCH
}

const pad = (n) => String(n).padStart(2, "0")

const formatSerial = (serial) => {
  const date = new Date(Math.round((serial - SERIAL_UNIX_EPOCH) * MS_PER_DAY))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
}

const text = (value) => (value === null || value === undefined ? "" : String(value))

// Rows -> records, newest deletion first. Rows without a usable time go last;
// ties keep the later row (appended later) first.
export const parseHistory = (values = []) =>
  values
    .map((row, index) => {
      const serial = toSerial(row[7])
      const labels = parseLabels(row[10])
      return {
        row: index + 1,
        id: text(row[0]),
        title: text(row[1]),
        issueId: text(row[2]),
        des: text(row[3]),
        column: text(row[4]),
        priority: text(row[5]),
        assignee: text(row[6]),
        serial,
        deletedAt: serial === null ? text(row[7]) : formatSerial(serial),
        // A date the Sheet recognised comes as a serial; text stays as written.
        createdAt: typeof row[8] === "number" ? formatSerial(row[8]) : text(row[8]),
        ...(row[9] !== undefined && row[9] !== "" ? { movedAt: typeof row[9] === "number" ? formatSerial(row[9]) : text(row[9]) } : {}),
        ...(labels.length ? { labels } : {}),
      }
    })
    .filter((r) => r.id || r.title)
    .sort((a, b) => {
      if (a.serial !== b.serial) {
        if (a.serial === null) return 1
        if (b.serial === null) return -1
        return b.serial - a.serial
      }
      return b.row - a.row
    })

// Every space-separated term must appear in one of the searchable fields.
export const filterHistory = (records, query) => {
  const terms = searchTerms(query)
  if (!terms.length) return records
  return records.filter((r) => matchesTerms([r.title, r.des, r.issueId, r.column, r.assignee, ...parseLabels(r.labels)], terms))
}
