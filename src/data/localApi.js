import { t } from '@/i18n'
import { DataError } from './errors'

// The desktop app's local server (desktop/server). It writes its API token
// into the page it serves, so this is only set when the page came from it.
const settings = () => globalThis.__SAF_KANBAN_LOCAL__ || null

export const localAvailable = () => !!settings()?.token

export const localToken = () => settings()?.token || ""

export const localCanUpdate = () => !!settings()?.canUpdate

export const localServerVersion = () => settings()?.serverVersion || ""

// Error codes with a translated message; anything else shows the server's own text.
const KNOWN_CODES = [
  "BOARD_NOT_FOUND",
  "TASK_NOT_FOUND",
  "DELETED_TASK_NOT_FOUND",
  "TASK_EXISTS",
  "COLUMN_GONE",
  "UNKNOWN_COLUMN",
  "NO_COLUMNS",
  "COLUMN_NOT_EMPTY",
  "DUPLICATE_COLUMN",
  "DUPLICATE_USER",
  "DUPLICATE_LABEL",
  "LABEL_IN_USE",
  "EMPTY_COLUMN_NAME",
  "UNSUPPORTED_BOARD_FILE",
  "STORAGE_ERROR",
  "UNSUPPORTED_IMAGE_TYPE",
  "ATTACHMENT_TOO_LARGE",
  "ATTACHMENT_NOT_FOUND",
  "INVALID_ATTACHMENT",
]

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

function toApiError(data, status) {
  const error = data?.error || {}
  const message = KNOWN_CODES.includes(error.code)
    ? t(`localError.${error.code}`, error.params || {})
    : t("local.error", { message: error.message || `HTTP ${status}` })
  return Object.assign(new DataError(message), { code: error.code, status })
}

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

  throw toApiError(data, response.status)
}

// Uploads a raster image (PNG/JPEG/WebP/GIF) to a local board's attachment
// folder and returns `{ filename, markdown, mime, size }`.
export async function uploadLocalAttachment(boardId, file) {
  if (!file) throw new DataError(t("localError.UNSUPPORTED_IMAGE_TYPE"))
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw Object.assign(new DataError(t("localError.ATTACHMENT_TOO_LARGE")), {
      code: "ATTACHMENT_TOO_LARGE",
    })
  }
  let response
  try {
    response = await fetch(`/api/boards/${encodeURIComponent(boardId)}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings()?.token}`,
        "Content-Type": file.type || "application/octet-stream",
        "X-Filename": encodeURIComponent(file.name || "image.png"),
      },
      body: file,
    })
  } catch {
    throw new DataError(t("local.unreachable"))
  }

  const data = await response.json().catch(() => null)
  if (response.ok) return data
  throw toApiError(data, response.status)
}

// Fetches a local board attachment using the Bearer token and caches its
// in-memory `blob:` URL so reopening tasks or toggling Preview is instant.
const attachmentUrlCache = new Map()
const attachmentInflight = new Map()

export function fetchLocalAttachmentUrl(boardId, filename) {
  const key = `${boardId}/${filename}`
  if (attachmentUrlCache.has(key)) {
    return Promise.resolve(attachmentUrlCache.get(key))
  }
  if (attachmentInflight.has(key)) {
    return attachmentInflight.get(key)
  }
  const promise = fetch(
    `/api/boards/${encodeURIComponent(boardId)}/attachments/${encodeURIComponent(filename)}`,
    {
      headers: { Authorization: `Bearer ${settings()?.token}` },
    }
  )
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      attachmentUrlCache.set(key, url)
      return url
    })
    .finally(() => {
      attachmentInflight.delete(key)
    })
  attachmentInflight.set(key, promise)
  return promise
}

// One event stream for the page, opened when something first listens. The
// server sends { kind: "board" | "boards", boardId } after every change,
// including changes made by other programs through the API.
let stream = null
const listeners = new Set()

const openStream = () => {
  stream = new EventSource(`/api/events?token=${encodeURIComponent(localToken())}`)
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

export function onLocalChange(listener) {
  if (!stream && localAvailable()) openStream()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// After the token was replaced: requests use the new one from now on, and the
// event stream (which signed in with the old one) is opened again.
export function setLocalToken(token) {
  globalThis.__SAF_KANBAN_LOCAL__ = { ...settings(), token }
  if (stream) {
    stream.close()
    openStream()
  }
}
