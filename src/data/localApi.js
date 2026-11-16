import { t } from '@/i18n'
import { DataError } from './errors'

// The desktop app's local server (desktop/server). It writes its API token
// into the page it serves, so this is only set when the page came from it.
const settings = () => globalThis.__SAF_KANBAN_LOCAL__ || null

export const localAvailable = () => !!settings()?.token

// Error codes with a translated message; anything else shows the server's own text.
const KNOWN_CODES = [
  "BOARD_NOT_FOUND",
  "TASK_NOT_FOUND",
  "UNKNOWN_COLUMN",
  "NO_COLUMNS",
  "COLUMN_NOT_EMPTY",
  "DUPLICATE_COLUMN",
  "DUPLICATE_USER",
  "EMPTY_COLUMN_NAME",
  "UNSUPPORTED_BOARD_FILE",
  "STORAGE_ERROR",
]

// Calls the local API. Resolves with the JSON answer (null when there is
// none) and rejects with a DataError the user can read.
export async function localRequest(method, path, body) {
  let response
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${settings()?.token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new DataError(t("local.unreachable"))
  }

  const data = response.status === 204 ? null : await response.json().catch(() => null)
  if (response.ok) return data

  const error = data?.error || {}
  const message = KNOWN_CODES.includes(error.code)
    ? t(`localError.${error.code}`, error.params || {})
    : t("local.error", { message: error.message || `HTTP ${response.status}` })
  throw Object.assign(new DataError(message), { code: error.code, status: response.status })
}

// One event stream for the page, opened when something first listens. The
// server sends { kind: "board" | "boards", boardId } after every change,
// including changes made by other programs through the API.
let stream = null
const listeners = new Set()

export function onLocalChange(listener) {
  if (!stream && localAvailable()) {
    stream = new EventSource(`/api/events?token=${encodeURIComponent(settings().token)}`)
    stream.addEventListener("change", (event) => {
      let change
      try {
        change = JSON.parse(event.data)
      } catch {
        return
      }
      listeners.forEach((each) => each(change))
    })
  }
  listeners.add(listener)
  return () => listeners.delete(listener)
}
