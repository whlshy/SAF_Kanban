import { normalizeLabelDefs, parseLabels } from '../lib/labels.js'

// How a board's data is laid out in its Google Sheet, and how a task is sent
// to the Apps Script. The rest of the app only sees the shapes returned here.
//
// Task: { id, title, issueId, des, column, priority, assignee, createdAt?, movedAt?, labels? }

// kanban sheet, columns A:G, in row order. H is when the task was created
// (Apps Script v3+), I is when it last moved into its current column (v4+),
// and J is comma-separated labels (v6+); older scripts leave them empty.
export const rowsToTasks = (rows = []) =>
  rows.map((row) => {
    const labels = parseLabels(row[9])
    return {
      id: row[0],
      title: row[1],
      issueId: row[2],
      des: row[3],
      column: row[4],
      priority: row[5],
      assignee: row[6],
      ...(row[7] ? { createdAt: String(row[7]) } : {}),
      ...(row[8] ? { movedAt: String(row[8]) } : {}),
      ...(labels.length ? { labels } : {}),
    }
  })

// columns sheet, column A. Blank rows would become a nameless column, so skip them.
export const rowsToColumns = (rows = []) => rows.filter((row) => row?.[0]).map((row) => row[0])

// users sheet: rows are either [name] or the older [id, name]; keep the names.
export const rowsToUsers = (rows = []) => [
  ...new Set(rows.map((row) => String(row?.[1] || row?.[0] || "").trim()).filter(Boolean)),
]

// labels sheet (optional): [name, color?]. Color can be a palette key or #RRGGBB.
export const rowsToLabels = (rows = []) =>
  normalizeLabelDefs(rows.map((row) => ({ name: row?.[0], color: row?.[1] })))

// The Apps Script (every version) reads these field names; v6+ also reads `labels`.
export const taskToScript = (task) => ({
  id: task.id,
  title: task.title,
  jiraId: task.issueId,
  des: task.des,
  task: task.column,
  priority: task.priority,
  assignee: task.assignee,
  ...(task.labels !== undefined ? { labels: parseLabels(task.labels) } : {}),
})
