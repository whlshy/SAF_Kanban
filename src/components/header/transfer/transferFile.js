import { BOARD_FIELDS, boardTitle } from '@/store/boards'
import { t } from '@/i18n'
import { encryptText } from '@/lib/crypto'
import { localRequest } from '@/data/localApi'

// Export file format. Bump the version if the shape changes.
const FILE_APP = "saf-kanban"
const FILE_VERSION = 1
// A file with `kind: "board"` holds one local board whole (settings, tasks,
// deleted tasks) instead of the settings of Google Sheet boards.
const BOARD_KIND = "board"

const today = () => new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD

const saveFile = (content, name) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: "application/json" }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

// Saves a local board as a file. Importing the file makes a new board with
// the same content. Rejects with a DataError if the board can't be read.
export const exportLocalBoard = async (board) => {
  const content = await localRequest("GET", `/boards/${encodeURIComponent(board.id)}/export`)
  // Characters Windows doesn't allow in file names.
  // eslint-disable-next-line no-control-regex
  const name = boardTitle(board).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 60) || "board"
  saveFile(
    { app: FILE_APP, kind: BOARD_KIND, version: FILE_VERSION, exportedAt: new Date().toISOString(), board: content },
    `saf-kanban-board-${name}-${today()}.json`,
  )
}

// With a password, the settings JSON is encrypted and the file keeps only what
// import needs to recognize it: { app, version, encryption, data }.
export const exportBoards = async (boards, password) => {
  const settings = {
    app: FILE_APP,
    version: FILE_VERSION,
    exportedAt: new Date().toISOString(),
    // Write the displayed name so an untitled board keeps the name people know it by.
    boards: boards.map((b) => ({
      ...Object.fromEntries(BOARD_FIELDS.map((f) => [f, b[f] || ""])),
      title: boardTitle(b),
    })),
  }
  const file = password
    ? { app: FILE_APP, version: FILE_VERSION, ...(await encryptText(JSON.stringify(settings), password)) }
    : settings

  saveFile(file, `saf-kanban-settings-${today()}${password ? "-encrypted" : ""}.json`)
}

// Returns { boards } for a plain settings file, { locked } for a
// password-protected one, whose decrypted contents go through here again, or
// { localBoard } for a file holding one local board.
export const readImportFile = (text) => {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(t("transfer.error.json"))
  }
  if (data?.app !== FILE_APP) {
    throw new Error(t("transfer.error.format"))
  }
  if (data.version > FILE_VERSION) {
    throw new Error(t("transfer.error.version"))
  }
  if (data.encryption) {
    if (typeof data.data !== "string") throw new Error(t("transfer.error.format"))
    return { locked: data }
  }
  if (data.kind === BOARD_KIND) {
    const board = data.board
    if (!board || typeof board !== "object" || !Array.isArray(board.tasks)) throw new Error(t("transfer.error.format"))
    return { localBoard: board }
  }
  if (!Array.isArray(data.boards)) {
    throw new Error(t("transfer.error.format"))
  }
  const boards = data.boards
    .filter((b) => b && typeof b === "object")
    .map((b) => Object.fromEntries(BOARD_FIELDS.map((f) => [f, typeof b[f] === "string" ? b[f] : ""])))
  if (!boards.length) {
    throw new Error(t("transfer.error.empty"))
  }
  return { boards }
}

export const pickFile = () => new Promise((resolve) => {
  const input = document.createElement("input")
  input.type = "file"
  input.accept = "application/json,.json"
  input.onchange = () => input.files?.[0] && resolve(input.files[0])
  input.click()
})
