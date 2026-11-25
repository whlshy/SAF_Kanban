import config from "Config"

const { apiurl } = config

// Thin fetch wrapper for Google Sheets API and Google Apps Script requests.
// Keeps GET requests free of Content-Type headers so cross-origin calls to
// Apps Script don't trigger a CORS preflight OPTIONS request.
export default async function api({
  cmd,
  cmd_url = null,
  method = "GET",
  data = {},
  header = {},
}) {
  const upperMethod = method.toUpperCase()
  let url = cmd_url == null ? `${apiurl}/${cmd}` : cmd_url
  const headers = { ...header }
  const options = {
    method: upperMethod,
    headers,
    credentials: "omit",
  }

  if (upperMethod === "GET") {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(data || {})) {
      if (value !== undefined && value !== null) {
        params.append(key, String(value))
      }
    }
    const qs = params.toString()
    if (qs) url += (url.includes("?") ? "&" : "?") + qs
  } else {
    headers["Content-Type"] = headers["Content-Type"] || "application/json"
    options.body = JSON.stringify(data)
  }

  const res = await fetch(url, options)
  const text = await res.text()
  let body = text
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  } else {
    body = null
  }

  return {
    ok: res.status === 200,
    status: res.status,
    body,
  }
}
