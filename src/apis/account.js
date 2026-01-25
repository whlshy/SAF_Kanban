import api from '../lib/api'

export const getAccount = async () => {
  const response = await api({ method: "GET", cmd: "api/Member" })
  return response
}

export const logoutAccount = async () => {
  const response = await api({ method: "POST", cmd: "api/Auth/logout" })
  return response
}

export const getGoogleSheetIssue = async () => {
  const response = await api({
    method: "GET",
    cmd_url: `https://sheets.googleapis.com/v4/spreadsheets/1ehRPqqtjiyiZeCXwOqalwgaMIFyE8kL2At4rUKp36Ug/values/kanban!A:G?alt=json&key=AIzaSyDPwaw0jfTbUMM1qrdEwB4ZUivo8dBdEbA`
  })
  return response
}

export const getGoogleSheetTask = async () => {
  const response = await api({
    method: "GET",
    cmd_url: `https://sheets.googleapis.com/v4/spreadsheets/1ehRPqqtjiyiZeCXwOqalwgaMIFyE8kL2At4rUKp36Ug/values/columns!A:B?alt=json&key=AIzaSyDPwaw0jfTbUMM1qrdEwB4ZUivo8dBdEbA`
  })
  return response
}

export const setGoogleSheetIssue = async ({list = []}) => {
  const response = await api({
    method: "POST",
    cmd_url: `https://script.google.com/macros/s/${localStorage.getItem('sheet')}/exec`,
    data:{ list: list },
    header: {
      'Content-Type': 'text/plain;charset=utf-8' 
    }
  })
  return response
}