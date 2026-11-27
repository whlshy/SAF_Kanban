import { useCallback, useMemo, useState } from 'react'
import { atom, getDefaultStore, useAtom, useAtomValue } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { useSearchParams } from 'react-router-dom'
import { t } from '@/i18n'
import { localAvailable, localRequest, onLocalChange } from '@/data/localApi'

// Each board is one set of settings pointing at its own Google Sheet and
// Apps Script deployment. The list lives in localStorage; which board a tab
// shows comes from the URL (?board=<id>), so tabs can show different boards.
//
// In the desktop app there are also local boards (type "local"): the local
// server keeps them, settings and tasks, as files on this computer. They are
// listed before the Google Sheet boards.

const BOARDS_KEY = "boards"
const LAST_BOARD_KEY = "lastBoardId"
const SHEETS_MIGRATED_KEY = "sheetsMigratedToDisk"
export const DEFAULT_BOARD_ID = "default"
export const DEFAULT_TITLE = "SAF Kanban"
// "Make a copy" link of the template Sheet (tabs and Apps Script ready to deploy).
export const TEMPLATE_COPY_URL = "https://docs.google.com/spreadsheets/d/1-gsXi8JZQrIwAiK6q2koaPp0resipV-G_0YFYOja7yc/copy"

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

export const BOARD_FIELDS = ["title", "sheetId", "scriptId", "userKey", "jiraLink"]

// The Sheet ID and Apps Script Deployment ID fields also accept the full URLs
// people copy (the Sheet's address bar, the deployment's .../exec URL).
export const normalizeBoardField = (field, value) => {
  if (field === "sheetId") {
    const text = String(value ?? "").trim()
    return text.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1] || text
  }
  if (field === "scriptId") {
    const text = String(value ?? "").trim()
    return text.match(/\/macros\/s\/([A-Za-z0-9_-]+)\/exec/)?.[1] || text
  }
  return value
}

const normalizeBoardFields = (fields = {}) =>
  Object.fromEntries(Object.entries(fields).map(([field, value]) => [field, normalizeBoardField(field, value)]))

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

// Local boards and shared Google Sheet boards from the desktop server;
// null until first loaded in desktop mode.
const localBoardsAtom = atom(localAvailable() ? null : [])
const desktopSheetsAtom = atom(localAvailable() ? null : [])

const toLocalBoard = (info) => ({
  id: info.id,
  type: "local",
  title: info.title,
  jiraLink: info.issueLink,
  columns: info.columns,
  users: info.users,
  labels: info.labels || [],
})

const toSheetBoard = (info) => createBoard(info.id, {
  title: info.title || "",
  sheetId: info.sheetId || "",
  scriptId: info.scriptId || "",
  userKey: info.userKey || "",
  jiraLink: info.jiraLink || "",
})

const reloadLocalBoards = async () => {
  const list = await localRequest("GET", "/boards")
  getDefaultStore().set(localBoardsAtom, list.map(toLocalBoard))
}

const reloadDesktopSheets = async ({ allowMigration = false } = {}) => {
  let list = await localRequest("GET", "/sheets")
  // One-time migration: carry over any Google Sheet boards previously stored
  // only in the desktop WebView's localStorage into `<data dir>/sheets.json`.
  if (allowMigration && !list.length) {
    try {
      if (localStorage.getItem(SHEETS_MIGRATED_KEY) !== "1") {
        const legacy = JSON.parse(localStorage.getItem(BOARDS_KEY) || "[]")
        if (Array.isArray(legacy) && legacy.length) {
          list = await localRequest("PUT", "/sheets", legacy.map(toSheetBoard))
        }
        localStorage.setItem(SHEETS_MIGRATED_KEY, "1")
      }
    } catch {
      // Ignore malformed legacy localStorage
    }
  } else if (allowMigration) {
    try { localStorage.setItem(SHEETS_MIGRATED_KEY, "1") } catch { /* ignore */ }
  }
  getDefaultStore().set(desktopSheetsAtom, list.map(toSheetBoard))
}

const saveDesktopSheets = (next) => {
  const normalized = next.map(toSheetBoard)
  getDefaultStore().set(desktopSheetsAtom, normalized)
  return localRequest("PUT", "/sheets", normalized).then((saved) => {
    const mapped = saved.map(toSheetBoard)
    getDefaultStore().set(desktopSheetsAtom, mapped)
    return mapped
  })
}

if (localAvailable()) {
  reloadLocalBoards().catch(() => getDefaultStore().set(localBoardsAtom, []))
  reloadDesktopSheets({ allowMigration: true }).catch(() => getDefaultStore().set(desktopSheetsAtom, []))
  // Boards or sheets added, renamed or removed by another window, CLI, or API.
  onLocalChange((change) => {
    if (change.kind === "boards") {
      reloadLocalBoards().catch(() => {})
      reloadDesktopSheets().catch(() => {})
    }
  })
}

// The default board keeps "SAF Kanban" as its fallback so upgrading users see
// no change; other untitled boards read "未命名看板" / "Untitled board".
export const boardPlaceholderTitle = (board) =>
  !board || board.id === DEFAULT_BOARD_ID ? DEFAULT_TITLE : t("board.untitled")

export const boardTitle = (board) => board?.title?.trim() || boardPlaceholderTitle(board)

// A new board whose name another board already shows gets the first free
// number: "Kanban" → "Kanban (1)", "Kanban (2)", … ("Kanban (1)" counts on
// from "Kanban"). Names match exactly, as when importing. An untitled board is
// matched by its placeholder and, when numbered, keeps it as its title.
export const uniqueBoardTitle = (title, boards, placeholder) => {
  const name = String(title ?? "").trim()
  const shown = name || placeholder
  const taken = new Set(boards.map(boardTitle))
  if (!taken.has(shown)) return name
  const base = shown.replace(/\s*\(\d+\)$/, "") || shown
  let n = 1
  while (taken.has(`${base} (${n})`)) n++
  return `${base} (${n})`
}

export function useBoards() {
  const [webStored, setWebStored] = useAtom(boardsAtom)
  const localBoards = useAtomValue(localBoardsAtom)
  const desktopSheets = useAtomValue(desktopSheetsAtom)
  const [searchParams, setSearchParams] = useSearchParams()
  // Read once per mount: syncing it across tabs would switch other tabs' boards.
  const [lastBoardId] = useState(() => localStorage.getItem(LAST_BOARD_KEY))

  const isDesktop = localAvailable()
  const stored = useMemo(() => (isDesktop ? (desktopSheets || []) : webStored), [isDesktop, desktopSheets, webStored])
  const loading = localBoards === null || (isDesktop && desktopSheets === null)
  const boards = useMemo(() => [...(localBoards || []), ...stored], [localBoards, stored])

  const persistSheets = useCallback((nextOrUpdater) => {
    if (isDesktop) {
      const prev = getDefaultStore().get(desktopSheetsAtom) || []
      const next = typeof nextOrUpdater === "function" ? nextOrUpdater(prev) : nextOrUpdater
      return saveDesktopSheets(next)
    }
    setWebStored(nextOrUpdater)
    return undefined
  }, [isDesktop, setWebStored])

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

  // A Google Sheet board is saved to `<data dir>/sheets.json` in the desktop
  // app (or localStorage on the web). A local board (fields.type "local",
  // optionally with `columns`, `users`, and the `tasks` and `history` of a
  // board being copied or imported) is created by the local server.
  const addBoard = useCallback((fields) => {
    const title = (id) => uniqueBoardTitle(fields.title, boards, boardPlaceholderTitle({ id }))

    if (fields.type === "local") {
      return localRequest("POST", "/boards", {
        title: title(),
        issueLink: fields.jiraLink || "",
        columns: fields.columns,
        users: fields.users,
        labels: fields.labels,
        tasks: fields.tasks,
        history: fields.history,
      }).then(async (info) => {
        await reloadLocalBoards()
        switchBoard(info.id)
        return toLocalBoard(info)
      })
    }

    const id = stored.length ? newBoardId() : DEFAULT_BOARD_ID
    const board = createBoard(id, { ...normalizeBoardFields(fields), title: title(id) })
    persistSheets([...stored, board])
    if (!isDesktop && board.id === DEFAULT_BOARD_ID) writeLegacy(board)
    switchBoard(board.id)
    return board
  }, [boards, stored, persistSheets, isDesktop, switchBoard])

  // With no boards yet, the first edit creates the default board, so a new
  // user fills in the settings exactly as before. For a local board the patch
  // may also carry `columns`, `users` and `renames` (old column name -> new),
  // and the result is a promise that rejects with a DataError.
  const updateCurrentBoard = useCallback((patch) => {
    if (currentBoard?.type === "local") {
      const { jiraLink, ...rest } = patch
      return localRequest("PATCH", `/boards/${currentBoard.id}`, {
        ...rest,
        ...(jiraLink === undefined ? {} : { issueLink: jiraLink }),
      }).then(reloadLocalBoards)
    }

    const normalizedPatch = normalizeBoardFields(patch)
    const target = currentBoard || createBoard(DEFAULT_BOARD_ID)
    const updated = { ...target, ...normalizedPatch }
    const promise = persistSheets((prev) => currentBoard
      ? prev.map((b) => (b.id === updated.id ? { ...b, ...normalizedPatch } : b))
      : [...prev, updated])
    if (!isDesktop && updated.id === DEFAULT_BOARD_ID) writeLegacy(updated)
    return promise
  }, [currentBoard, persistSheets, isDesktop])

  // Adds boards (e.g. from an imported file) with fresh ids. If there were no
  // boards yet, the first one becomes the default board like any first board.
  const importBoards = useCallback((list) => {
    const added = list.map((fields, i) => createBoard(
      !stored.length && i === 0 ? DEFAULT_BOARD_ID : newBoardId(),
      normalizeBoardFields(Object.fromEntries(BOARD_FIELDS.map((f) => [f, fields[f] || ""])))
    ))
    persistSheets([...stored, ...added])
    if (!isDesktop && added[0]?.id === DEFAULT_BOARD_ID) writeLegacy(added[0])
    return added
  }, [stored, persistSheets, isDesktop])

  // Removing a Google Sheet board only forgets its settings. A local board's
  // file is moved to the trash folder by the server (a promise, as above).
  const deleteBoard = useCallback((id) => {
    const remaining = boards.filter((b) => b.id !== id)
    const next = () => switchBoard(remaining[0]?.id || "")

    if (boards.find((b) => b.id === id)?.type === "local") {
      return localRequest("DELETE", `/boards/${id}`).then(reloadLocalBoards).then(next)
    }
    const promise = persistSheets(stored.filter((b) => b.id !== id))
    if (!isDesktop && id === DEFAULT_BOARD_ID) writeLegacy(null)
    if (promise) return promise.then(next)
    next()
  }, [boards, stored, persistSheets, isDesktop, switchBoard])

  return { boards, currentBoard, loading, switchBoard, addBoard, updateCurrentBoard, importBoards, deleteBoard }
}
