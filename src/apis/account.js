import api from '../lib/api'
import { t } from '@/i18n'
import { translateScriptError } from './scriptErrors'

// An Apps Script failure with a message the user can act on (shown as is).
export class ScriptError extends Error {
  constructor(userMessage) {
    super(userMessage)
    this.userMessage = userMessage
  }
}

export const getAccount = async () => {
  const response = await api({ method: "GET", cmd: "api/Member" })
  return response
}

export const logoutAccount = async () => {
  const response = await api({ method: "POST", cmd: "api/Auth/logout" })
  return response
}

export const getGoogleSheetIssue = async (sheetId) => {
  const response = await api({
    method: "GET",
    cmd_url: `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/kanban!A:G?alt=json&key=AIzaSyDPwaw0jfTbUMM1qrdEwB4ZUivo8dBdEbA`
  })
  return response
}

export const getGoogleSheetTask = async (sheetId) => {
  const response = await api({
    method: "GET",
    cmd_url: `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/columns!A:B?alt=json&key=AIzaSyDPwaw0jfTbUMM1qrdEwB4ZUivo8dBdEbA`
  })
  return response
}

export const getGoogleSheetUsers = async (sheetId) => {
  const response = await api({
    method: "GET",
    cmd_url: `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/users!A:B?alt=json&key=AIzaSyDPwaw0jfTbUMM1qrdEwB4ZUivo8dBdEbA`
  })
  return response
}

export const setGoogleSheetIssue = async ({ scriptId, sheetId, action, task, id, status, beforeId, afterId }) => {
  if (!scriptId) {
    throw new ScriptError(t("script.missing"))
  }

  // A deployment that is misconfigured answers with a Google login or error
  // page instead of JSON; the browser reports that as a CORS/network error.
  const response = await api({
    method: "GET",
    cmd_url: `https://script.google.com/macros/s/${scriptId}/exec`,
    data: {
      action,
      ...(task ? { task: JSON.stringify(task) } : {}),
      ...(id ? { id } : {}),
      ...(status ? { status } : {}),
      ...(beforeId ? { beforeId } : {}),
      ...(afterId ? { afterId } : {}),
      // Newer scripts refuse to write when this isn't the Sheet they are bound to.
      ...(sheetId ? { sheetId } : {}),
    },
  }).catch(() => {
    throw new ScriptError(t("script.unreachable"))
  })

  if (response.body?.status === "error") {
    throw new ScriptError(t("script.error", { message: translateScriptError(response.body) }))
  }
  if (!response.ok) {
    throw new ScriptError(t("script.unreachable"))
  }

  return response
}
