import { localRequest, onLocalChange } from './localApi'

// Board data kept by the desktop app's local server, as a file on this
// computer. Nothing here needs the network.

const pad = (n) => String(n).padStart(2, "0")

// "2026-11-16T08:30:00.000Z" -> "2026-11-16 16:30" in this computer's time zone.
export const formatLocalTime = (iso) => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso || "")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export const createLocalSource = ({ id }) => {
  const board = `/boards/${encodeURIComponent(id)}`
  const task = (taskId) => `${board}/tasks/${encodeURIComponent(taskId)}`

  return {
    type: "local",
    key: id,
    ready: true,
    needsNetwork: false,

    loadColumns: async () => (await localRequest("GET", board)).columns,
    loadUsers: async () => (await localRequest("GET", board)).users,
    loadTasks: () => localRequest("GET", `${board}/tasks`),

    // The server lists deleted tasks newest first.
    loadHistory: async () => {
      const deleted = await localRequest("GET", `${board}/history`)
      return {
        status: "ready",
        records: deleted.map((record, index) => ({
          ...record,
          row: deleted.length - index,
          deletedAt: formatLocalTime(record.deletedAt),
        })),
      }
    },

    saveTask: (saved) => localRequest("PUT", task(saved.id), saved),
    moveTask: ({ id: taskId, column, beforeId, afterId }) =>
      localRequest("POST", `${task(taskId)}/move`, { column, beforeId, afterId }),
    deleteTask: (taskId) => localRequest("DELETE", task(taskId)),

    // Calls `listener` whenever this board's content changes, whoever changed
    // it. Returns a function that stops listening.
    subscribe: (listener) => onLocalChange((change) => change.kind === "board" && change.boardId === id && listener()),
  }
}
