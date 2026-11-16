import api from '@/lib/api'
import { t } from '@/i18n'
import { parseHistory } from '@/lib/history'
import { DataError } from './errors'
import { translateScriptError } from './scriptErrors'
import { rowsToColumns, rowsToTasks, rowsToUsers, taskToScript } from './sheetFormat'

// Board data kept in the user's own Google Sheet. Reads use the Sheets API
// with the project's shared key (the Sheet is shared as "anyone with the link
// can view"); writes go through the Apps Script the user deployed on the Sheet.

const SHEETS_API_KEY = "AIzaSyDPwaw0jfTbUMM1qrdEwB4ZUivo8dBdEbA"

const fetchRange = (sheetId, range, params = {}) => api({
  method: "GET",
  cmd_url: `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`,
  data: { alt: "json", ...params, key: SHEETS_API_KEY },
})

// A Sheet that isn't shared answers 403; that reads as "no rows", and the
// board then explains what to check. Other failures are errors.
const readRows = async (sheetId, range) => {
  const response = await fetchRange(sheetId, range)
  if (!response.ok) {
    throw Object.assign(new Error(`Sheets API answered ${response.status}`), { status: response.status })
  }
  return response.body?.values || []
}

export const createSheetSource = ({ sheetId, scriptId }) => {
  const callScript = async (params) => {
    if (!scriptId) throw new DataError(t("script.missing"))
    if (navigator.onLine === false) throw new DataError(t("offline.cannotWrite"))

    // A deployment that is misconfigured answers with a Google login or error
    // page instead of JSON; the browser reports that as a CORS/network error.
    const response = await api({
      method: "GET",
      cmd_url: `https://script.google.com/macros/s/${scriptId}/exec`,
      data: {
        ...Object.fromEntries(Object.entries(params).filter(([, value]) => value)),
        // Newer scripts refuse to write when this isn't the Sheet they are bound to.
        ...(sheetId ? { sheetId } : {}),
      },
    }).catch(() => {
      throw new DataError(t("script.unreachable"))
    })

    if (response.body?.status === "error") {
      throw new DataError(t("script.error", { message: translateScriptError(response.body) }))
    }
    if (!response.ok) throw new DataError(t("script.unreachable"))
  }

  return {
    type: "sheet",
    // Identifies the stored data, for caching what was loaded.
    key: sheetId || "",
    // False until the board has the settings needed to read it.
    ready: !!sheetId,
    needsNetwork: true,

    loadColumns: async () => rowsToColumns(await readRows(sheetId, "columns!A:B")),
    loadTasks: async () => rowsToTasks(await readRows(sheetId, "kanban!A:G")),
    loadUsers: async () => rowsToUsers(await readRows(sheetId, "users!A:B")),

    // Deleted tasks, newest first. `missing`: there is no history sheet (an
    // older Apps Script, or nothing deleted yet), which isn't an error.
    loadHistory: async () => {
      // Raw values so the deletion time comes back as a date serial number (or
      // the text the script wrote) instead of a string in the Sheet's locale.
      const response = await fetchRange(sheetId, "history!A:H", {
        valueRenderOption: "UNFORMATTED_VALUE",
        dateTimeRenderOption: "SERIAL_NUMBER",
      }).catch(() => null)
      if (response?.ok && !response.body?.error) {
        return { status: "ready", records: parseHistory(response.body?.values) }
      }
      const message = String(response?.body?.error?.message || "")
      if (response?.status === 400 && /parse range/i.test(message)) {
        return { status: "missing", records: [] }
      }
      return { status: "error", records: [] }
    },

    // Creates the task, or updates the one with the same id.
    saveTask: (task) => callScript({ action: "upsert", task: JSON.stringify(taskToScript(task)) }),
    // Puts the task in `column`, right before `beforeId` or else right after
    // `afterId`; with neither, it keeps its place in the stored order.
    moveTask: ({ id, column, beforeId, afterId }) =>
      callScript({ action: "move", id, status: column, beforeId, afterId }),
    deleteTask: (id) => callScript({ action: "delete", id }),
  }
}
