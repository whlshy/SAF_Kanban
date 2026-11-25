import React from 'react'
import { message } from '@/lib/notify'
import { localCanUpdate, localRequest, onLocalChange } from '@/data/localApi'
import { t } from '@/i18n'

// In-app update notifications for the installed desktop app. The server
// (desktop/app) checks GitHub Releases, verifies the signature, and reports
// state changes over the existing /api/events SSE stream (`kind: "update"`).

const UPDATE_KEY = "desktop-update"
const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000

let dismissedVersion = null
let started = false

function showState(state) {
  if (!state) return

  if (state.status === "idle") return

  if (state.status === "checking") {
    // A manual check was requested: allow showing the prompt again even if the
    // user dismissed this version earlier.
    dismissedVersion = null
    message.open({
      key: UPDATE_KEY,
      type: "loading",
      duration: 0,
      content: t("desktopUpdate.checking"),
    })
    return
  }

  if (state.status === "upToDate") {
    message.open({
      key: UPDATE_KEY,
      type: "success",
      duration: 3,
      content: t("desktopUpdate.upToDate", { version: state.currentVersion }),
    })
    return
  }

  if (state.status === "available") {
    if (dismissedVersion && dismissedVersion === state.version) return
    message.open({
      key: UPDATE_KEY,
      type: "info",
      duration: 0,
      content: (
        <span>
          {t("desktopUpdate.available", { version: state.version })}
          <button
            type="button"
            onClick={() => installDesktopUpdate()}
            className="ml-3 font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            {t("desktopUpdate.install")}
          </button>
          {state.releaseUrl && (
            <a
              href={state.releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-3 text-blue-600 hover:underline dark:text-blue-400"
            >
              {t("desktopUpdate.notes")}
            </a>
          )}
          <button
            type="button"
            onClick={() => {
              dismissedVersion = state.version
              message.destroy(UPDATE_KEY)
            }}
            className="ml-3 text-muted-foreground hover:text-foreground"
          >
            {t("pwa.later")}
          </button>
        </span>
      ),
    })
    return
  }

  if (state.status === "downloading") {
    const percent = state.total > 0
      ? Math.min(100, Math.round((state.downloaded / state.total) * 100))
      : null
    message.open({
      key: UPDATE_KEY,
      type: "loading",
      duration: 0,
      content: percent === null
        ? t("desktopUpdate.downloading", { version: state.version || "" })
        : t("desktopUpdate.downloadingPercent", { version: state.version || "", percent }),
    })
    return
  }

  if (state.status === "installing") {
    message.open({
      key: UPDATE_KEY,
      type: "loading",
      duration: 0,
      content: t("desktopUpdate.installing"),
    })
    return
  }

  if (state.status === "error") {
    message.open({
      key: UPDATE_KEY,
      type: "error",
      duration: 8,
      content: (
        <span>
          {t("desktopUpdate.error", { message: state.error || "" })}
          <button
            type="button"
            onClick={() => checkForDesktopUpdate()}
            className="ml-3 font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            {t("history.retry")}
          </button>
        </span>
      ),
    })
  }
}

async function syncState() {
  try {
    const state = await localRequest("GET", "/update")
    showState(state)
  } catch {
    // Ignore when server is shutting down or updater is unavailable.
  }
}

export async function checkForDesktopUpdate({ silent = false } = {}) {
  if (!localCanUpdate()) return
  if (!silent) dismissedVersion = null
  try {
    const state = await localRequest("POST", "/update/check", { silent })
    if (!silent) showState(state)
  } catch (error) {
    if (!silent) {
      message.error(error?.userMessage || t("desktopUpdate.error", { message: "" }), 8)
    }
  }
}

export async function installDesktopUpdate() {
  if (!localCanUpdate()) return
  try {
    const state = await localRequest("POST", "/update/install")
    showState(state)
  } catch (error) {
    message.error(error?.userMessage || t("desktopUpdate.error", { message: "" }), 8)
  }
}

export function startDesktopUpdater() {
  if (started || !localCanUpdate()) return
  started = true

  onLocalChange((change) => {
    if (change.kind === "update") syncState()
  })

  // Pick up any update already found before the window finished loading.
  syncState()

  let checkedAt = Date.now()
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || Date.now() - checkedAt < UPDATE_CHECK_MS) return
    checkedAt = Date.now()
    checkForDesktopUpdate({ silent: true })
  })
}
