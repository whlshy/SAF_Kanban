import { atom, getDefaultStore } from 'jotai'

// Imperative toast queue stored in Jotai's default store so notifications can
// be pushed from anywhere (React components, React Query callbacks, SSE
// listeners, PWA hooks) without hooks or context.

const DEFAULT_DURATION_SEC = 3
const DEFAULT_MIN_RESUME_MS = 1000

export const toastsAtom = atom([])

// Per-toast auto-dismiss state: { timer, remainingMs, startedAt, paused }
const timers = new Map()
const hoveredKeys = new Set()
let nextId = 1

function clearTimer(key) {
  const state = timers.get(key)
  if (state?.timer !== undefined && state?.timer !== null) {
    clearTimeout(state.timer)
  }
  timers.delete(key)
}

function schedule(key, delayMs) {
  const timer = setTimeout(() => destroy(key), delayMs)
  // Don't keep Node test processes alive waiting on a toast timer.
  timer.unref?.()
  timers.set(key, {
    timer,
    remainingMs: delayMs,
    startedAt: Date.now(),
    paused: false,
  })
}

function pause(key) {
  if (key === undefined || key === null) return
  hoveredKeys.add(key)
  const state = timers.get(key)
  if (!state || state.paused) return
  if (state.timer !== null && state.timer !== undefined) {
    clearTimeout(state.timer)
  }
  const elapsed = Date.now() - state.startedAt
  timers.set(key, {
    timer: null,
    remainingMs: Math.max(0, state.remainingMs - elapsed),
    startedAt: 0,
    paused: true,
  })
}

function resume(key, minResumeMs = DEFAULT_MIN_RESUME_MS) {
  if (key === undefined || key === null) return
  hoveredKeys.delete(key)
  const state = timers.get(key)
  if (!state || !state.paused) return
  const delayMs = Math.max(state.remainingMs, minResumeMs)
  schedule(key, delayMs)
}

function destroy(key) {
  const store = getDefaultStore()
  if (key === undefined || key === null) {
    for (const state of timers.values()) {
      if (state.timer !== null && state.timer !== undefined) clearTimeout(state.timer)
    }
    timers.clear()
    hoveredKeys.clear()
    store.set(toastsAtom, [])
    return
  }
  clearTimer(key)
  hoveredKeys.delete(key)
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
    const delayMs = duration * 1000
    if (hoveredKeys.has(key)) {
      timers.set(key, {
        timer: null,
        remainingMs: delayMs,
        startedAt: 0,
        paused: true,
      })
    } else {
      schedule(key, delayMs)
    }
  }

  return () => destroy(key)
}

export const message = {
  open,
  destroy,
  pause,
  resume,
  success: (content, duration = DEFAULT_DURATION_SEC) => open({ type: "success", content, duration }),
  error: (content, duration = DEFAULT_DURATION_SEC) => open({ type: "error", content, duration }),
  info: (content, duration = DEFAULT_DURATION_SEC) => open({ type: "info", content, duration }),
  warning: (content, duration = DEFAULT_DURATION_SEC) => open({ type: "warning", content, duration }),
  loading: (content, duration = 0) => open({ type: "loading", content, duration }),
}
