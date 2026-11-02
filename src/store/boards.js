import { useCallback, useMemo, useState } from 'react'
import { useAtom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { useSearchParams } from 'react-router-dom'

// Each board is one set of settings pointing at its own Google Sheet and
// Apps Script deployment. The list lives in localStorage; which board a tab
// shows comes from the URL (?board=<id>), so tabs can show different boards.

const BOARDS_KEY = "boards"
const LAST_BOARD_KEY = "lastBoardId"
export const DEFAULT_BOARD_ID = "default"
export const DEFAULT_TITLE = "SAF Kanban"
export const UNTITLED_TITLE = "未命名看板"

// Settings from the single-board version. The default board keeps writing
// them so an older cached build still works.
const LEGACY_KEYS = {
  sheetId: { key: "sheetId", json: true },
  scriptId: { key: "sheet" },
  userKey: { key: "user" },
  jiraLink: { key: "jiraLink" },
  title: { key: "title", json: true },
}

const readLegacy = ({ key, json }) => {
  const raw = localStorage.getItem(key)
  if (raw === null) return null
  if (!json) return raw
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

const writeLegacy = (board) => {
  Object.entries(LEGACY_KEYS).forEach(([field, { key, json }]) => {
    if (board) {
      const value = board[field] || ""
      localStorage.setItem(key, json ? JSON.stringify(value) : value)
    } else {
      localStorage.removeItem(key)
    }
  })
}

const migrateLegacySettings = () => {
  try {
    if (localStorage.getItem(BOARDS_KEY) !== null) return

    const legacy = {}
    Object.entries(LEGACY_KEYS).forEach(([field, spec]) => {
      const value = readLegacy(spec)
      if (value) legacy[field] = value
    })

    const boards = Object.keys(legacy).length ? [createBoard(DEFAULT_BOARD_ID, legacy)] : []
    localStorage.setItem(BOARDS_KEY, JSON.stringify(boards))
  } catch {
    // localStorage unavailable: start with no boards
  }
}

const createBoard = (id, fields = {}) => ({
  id,
  title: "",
  sheetId: "",
  scriptId: "",
  userKey: "",
  jiraLink: "",
  ...fields,
})

const newBoardId = () => crypto.randomUUID().split('-')[0]

migrateLegacySettings()

const boardsAtom = atomWithStorage(BOARDS_KEY, [], undefined, { getOnInit: true })

// The default board keeps "SAF Kanban" as its fallback so upgrading users see
// no change; other untitled boards read "未命名看板" so they are not mixed up.
export const boardPlaceholderTitle = (board) =>
  !board || board.id === DEFAULT_BOARD_ID ? DEFAULT_TITLE : UNTITLED_TITLE

export const boardTitle = (board) => board?.title?.trim() || boardPlaceholderTitle(board)

export function useBoards() {
  const [boards, setBoards] = useAtom(boardsAtom)
  const [searchParams, setSearchParams] = useSearchParams()
  // Read once per mount: syncing it across tabs would switch other tabs' boards.
  const [lastBoardId] = useState(() => localStorage.getItem(LAST_BOARD_KEY))

  const requestedId = searchParams.get("board")
  const currentBoard = useMemo(
    () => boards.find((b) => b.id === requestedId)
      || boards.find((b) => b.id === lastBoardId)
      || boards[0]
      || null,
    [boards, requestedId, lastBoardId]
  )

  const switchBoard = useCallback((id) => {
    localStorage.setItem(LAST_BOARD_KEY, id)
    setSearchParams((params) => {
      const next = new URLSearchParams(params)
      if (id) next.set("board", id)
      else next.delete("board")
      return next
    })
  }, [setSearchParams])

  const addBoard = useCallback((fields) => {
    const board = createBoard(boards.length ? newBoardId() : DEFAULT_BOARD_ID, fields)
    setBoards([...boards, board])
    if (board.id === DEFAULT_BOARD_ID) writeLegacy(board)
    switchBoard(board.id)
    return board
  }, [boards, setBoards, switchBoard])

  // With no boards yet, the first edit creates the default board, so a new
  // user fills in the settings exactly as before.
  const updateCurrentBoard = useCallback((patch) => {
    const target = currentBoard || createBoard(DEFAULT_BOARD_ID)
    const updated = { ...target, ...patch }
    setBoards((prev) => currentBoard
      ? prev.map((b) => (b.id === updated.id ? { ...b, ...patch } : b))
      : [...prev, updated])
    if (updated.id === DEFAULT_BOARD_ID) writeLegacy(updated)
  }, [currentBoard, setBoards])

  const deleteBoard = useCallback((id) => {
    const remaining = boards.filter((b) => b.id !== id)
    setBoards(remaining)
    if (id === DEFAULT_BOARD_ID) writeLegacy(null)
    switchBoard(remaining[0]?.id || "")
  }, [boards, setBoards, switchBoard])

  return { boards, currentBoard, switchBoard, addBoard, updateCurrentBoard, deleteBoard }
}
