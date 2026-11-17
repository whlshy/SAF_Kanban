import { localAvailable } from './localApi'
import { createLocalSource } from './localSource'
import { createSheetSource } from './sheetSource'

// Where a board's data lives is decided by its `type`. Boards saved before
// there were types have none; they are Google Sheet boards.
//
// A source reads and writes one board's data:
//   type, key, ready, needsNetwork
//   loadColumns() -> [name]            loadUsers() -> [name]
//   loadTasks()   -> [task], in stored order
//   loadHistory() -> { status: "ready" | "missing" | "error", records }
//   saveTask(task), moveTask({ id, column, beforeId, afterId }), deleteTask(id)
// Task: { id, title, issueId, des, column, priority, assignee }
// Writes reject with a DataError when there is something to tell the user.
// Optional: subscribe(listener) -> stop, for data that other programs change.

const SOURCES = {
  sheet: createSheetSource,
  // Only inside the desktop app, where its local server answers.
  local: (board) => (localAvailable() ? createLocalSource(board) : null),
}

export const boardType = (board) => board?.type || "sheet"

// null for a type this version doesn't know (a board made by a newer version).
export const createBoardSource = (board) => (board ? SOURCES[boardType(board)]?.(board) || null : null)

export { DataError } from './errors'
