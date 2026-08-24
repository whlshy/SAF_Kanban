import api from '../lib/api'

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

export const setGoogleSheetIssue = async ({ action, task, id, status, beforeId, afterId }) => {
  const response = await api({
    method: "GET",
    cmd_url: `https://script.google.com/macros/s/${localStorage.getItem('sheet')}/exec`,
    data: {
      action,
      ...(task ? { task: JSON.stringify(task) } : {}),
      ...(id ? { id } : {}),
      ...(status ? { status } : {}),
      ...(beforeId ? { beforeId } : {}),
      ...(afterId ? { afterId } : {}),
    },
  })

  if (!response.ok || response.body?.status === "error") {
    throw new Error(response.body?.message || "Google Sheet update failed")
  }

  return response
}
