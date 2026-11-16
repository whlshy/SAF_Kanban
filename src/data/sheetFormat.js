// How a board's data is laid out in its Google Sheet, and how a task is sent
// to the Apps Script. The rest of the app only sees the shapes returned here.
//
// Task: { id, title, issueId, des, column, priority, assignee }

// kanban sheet, columns A:G, in row order.
export const rowsToTasks = (rows = []) =>
  rows.map((row) => ({
    id: row[0],
    title: row[1],
    issueId: row[2],
    des: row[3],
    column: row[4],
    priority: row[5],
    assignee: row[6],
  }))

// columns sheet, column A. Blank rows would become a nameless column, so skip them.
export const rowsToColumns = (rows = []) => rows.filter((row) => row?.[0]).map((row) => row[0])

// users sheet: rows are either [name] or the older [id, name]; keep the names.
export const rowsToUsers = (rows = []) => [
  ...new Set(rows.map((row) => String(row?.[1] || row?.[0] || "").trim()).filter(Boolean)),
]

// The Apps Script (every version) reads these field names.
export const taskToScript = (task) => ({
  id: task.id,
  title: task.title,
  jiraId: task.issueId,
  des: task.des,
  task: task.column,
  priority: task.priority,
  assignee: task.assignee,
})
