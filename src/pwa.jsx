import React, { useSyncExternalStore } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { message } from '@/lib/notify'
import { t } from '@/i18n'

// Installing the site as an app, and picking up new versions of it.
// The service worker itself is generated at build time (see vite.config.js):
// it keeps the app's files for opening offline and the last answer from each
// Google Sheet for showing the board offline.

// ---- Install ----
// Browsers that can install the site fire `beforeinstallprompt`, possibly
// before React starts, so it is kept here until a component asks for it.
let installEvent = null
const listeners = new Set()
const changed = () => listeners.forEach((listener) => listener())

window.addEventListener("beforeinstallprompt", (event) => {
  installEvent = event
  changed()
})
window.addEventListener("appinstalled", () => {
  installEvent = null
  changed()
})

// An event can only be used once; the browser sends another if it still applies.
const install = () => {
  const event = installEvent
  installEvent = null
  changed()
  event?.prompt()
}

const subscribe = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// A function that opens the browser's install dialog, or null when the site
// can't be installed right now (already installed, or not supported).
export function useInstallPrompt() {
  return useSyncExternalStore(subscribe, () => (installEvent ? install : null))
}

// ---- Updates ----
const UPDATE_KEY = "pwa-update"
const UPDATE_CHECK_MS = 60 * 60 * 1000

// A new version waits until every tab is closed, or until the user accepts it
// here, so a page is never reloaded in the middle of typing.
export function startPwa() {
  const update = registerSW({
    onNeedRefresh() {
      message.open({
        key: UPDATE_KEY,
        type: "info",
        duration: 0,
        content: (
          <span>
            {t("pwa.updateReady")}
            <button
              type="button"
              onClick={() => update(true)}
              className="ml-3 font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              {t("pwa.reload")}
            </button>
            <button
              type="button"
              onClick={() => message.destroy(UPDATE_KEY)}
              className="ml-3 text-muted-foreground hover:text-foreground"
            >
              {t("pwa.later")}
            </button>
          </span>
        ),
      })
    },
    // An installed app can stay open for days: look for a new version when it
    // comes back to the front, at most once an hour.
    onRegisteredSW(url, registration) {
      if (!registration) return
      let checkedAt = Date.now()
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible" || Date.now() - checkedAt < UPDATE_CHECK_MS) return
        checkedAt = Date.now()
        registration.update().catch(() => {})
      })
    },
  })
}
