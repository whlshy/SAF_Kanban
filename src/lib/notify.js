import { atom, getDefaultStore } from 'jotai'

// Imperative toast queue stored in Jotai's default store so notifications can
// be pushed from anywhere (React components, React Query callbacks, SSE
// listeners, PWA hooks) without hooks or context.

const DEFAULT_DURATION_SEC = 3

export const toastsAtom = atom([])

const timers = new Map()
let nextId = 1

function clearTimer(key) {
  const timer = timers.get(key)
  if (timer !== undefined) {
    clearTimeout(timer)
    timers.delete(key)
  }
}

function destroy(key) {
  const store = getDefaultStore()
  if (key === undefined || key === null) {
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    store.set(toastsAtom, [])
    return
  }
  clearTimer(key)
  store.set(toastsAtom, (prev) => prev.filter((item) => item.key !== key))
}

function open(options) {
  const {
    key = `toast-${nextId++}`,
    type = "info",
    content = "",
    duration = DEFAULT_DURATION_SEC,
  } = options || {}

  clearTimer(key)

  const entry = { key, type, content, duration }
  const store = getDefaultStore()
  store.set(toastsAtom, (prev) => {
    const idx = prev.findIndex((item) => item.key === key)
    if (idx >= 0) {
      const next = prev.slice()
      next[idx] = entry
      return next
    }
    return [...prev, entry]
  })

  if (typeof duration === "number" && duration > 0) {
    const timer = setTimeout(() => destroy(key), duration * 1000)
    // Don't keep Node test processes alive waiting on a toast timer.
    timer.unref?.()
    timers.set(key, timer)
  }

  return () => destroy(key)
}

export const message = {
  open,
  destroy,
  success: (content, duration = DEFAULT_DURATION_SEC) => open({ type: "success", content, duration }),
  error: (content, duration = DEFAULT_DURATION_SEC) => open({ type: "error", content, duration }),
  info: (content, duration = DEFAULT_DURATION_SEC) => open({ type: "info", content, duration }),
  warning: (content, duration = DEFAULT_DURATION_SEC) => open({ type: "warning", content, duration }),
  loading: (content, duration = 0) => open({ type: "loading", content, duration }),
}
