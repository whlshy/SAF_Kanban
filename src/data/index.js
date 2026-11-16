import { createSheetSource } from './sheetSource'

// Where a board's data lives is decided by its `type`. Boards saved before
// there were types have none; they are Google Sheet boards.
//
// A source reads and writes one board's data:
//   type, key, ready
//   loadColumns() -> [name]            loadUsers() -> [name]
//   loadTasks()   -> [task], in stored order
//   loadHistory() -> { status: "ready" | "missing" | "error", records }
//   saveTask(task), moveTask({ id, column, beforeId, afterId }), deleteTask(id)
// Task: { id, title, issueId, des, column, priority, assignee }
// Writes reject with a DataError when there is something to tell the user.

const SOURCES = {
  sheet: createSheetSource,
}

export const boardType = (board) => board?.type || "sheet"

// null for a type this version doesn't know (a board made by a newer version).
export const createBoardSource = (board) => (board ? SOURCES[boardType(board)]?.(board) || null : null)

export { DataError } from './errors'
