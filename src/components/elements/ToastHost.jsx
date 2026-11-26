import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAtomValue } from 'jotai'
import { CircularProgress } from '@mui/material'
import {
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Info as InfoIcon,
  WarningAmber as WarningIcon,
} from '@mui/icons-material'
import { message, toastsAtom } from '@/lib/notify'
import { useTheme } from '@/store/theme'

const EXIT_DURATION_MS = 180

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches)
  )
}

function ToastIcon({ type }) {
  switch (type) {
    case "success":
      return <CheckCircleIcon fontSize="small" color="success" sx={{ flexShrink: 0 }} />
    case "error":
      return <ErrorIcon fontSize="small" color="error" sx={{ flexShrink: 0 }} />
    case "warning":
      return <WarningIcon fontSize="small" color="warning" sx={{ flexShrink: 0 }} />
    case "loading":
      return <CircularProgress size={16} sx={{ flexShrink: 0 }} />
    default:
      return <InfoIcon fontSize="small" color="info" sx={{ flexShrink: 0 }} />
  }
}

// Portaled directly to document.body above MUI Dialogs (z-index 1300) so
// notifications are always visible regardless of where they were triggered.
// Because `.dark` lives on `#root` (not `<body>`), mirror it on the portal
// container so dark-mode tokens and `dark:` classes apply inside toasts too.
export default function ToastHost() {
  const toasts = useAtomValue(toastsAtom)
  const { isDark } = useTheme()
  const [rendered, setRendered] = useState(() =>
    toasts.map((toast) => ({ toast, closing: false }))
  )
  const exitTimersRef = useRef(new Map())

  useEffect(() => {
    const activeByKey = new Map(toasts.map((toast) => [toast.key, toast]))
    const reduced = prefersReducedMotion()

    setRendered((prev) => {
      const seen = new Set()
      const next = []

      for (const item of prev) {
        const key = item.toast.key
        const active = activeByKey.get(key)
        if (active) {
          seen.add(key)
          next.push({ toast: active, closing: false })
        } else if (!reduced) {
          next.push(item.closing ? item : { toast: item.toast, closing: true })
        }
      }

      for (const toast of toasts) {
        if (!seen.has(toast.key)) {
          next.push({ toast, closing: false })
        }
      }

      return next
    })
  }, [toasts])

  useEffect(() => {
    const timers = exitTimersRef.current
    const closingKeys = new Set()

    for (const item of rendered) {
      if (!item.closing) continue
      const key = item.toast.key
      closingKeys.add(key)
      if (!timers.has(key)) {
        const timer = setTimeout(() => {
          timers.delete(key)
          setRendered((cur) => cur.filter((x) => !(x.toast.key === key && x.closing)))
        }, EXIT_DURATION_MS)
        timers.set(key, timer)
      }
    }

    for (const [key, timer] of timers.entries()) {
      if (!closingKeys.has(key)) {
        clearTimeout(timer)
        timers.delete(key)
      }
    }
  }, [rendered])

  useEffect(() => {
    const timers = exitTimersRef.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  }, [])

  if (!rendered.length || typeof document === "undefined") return null

  return createPortal(
    <div
      role="region"
      aria-live="polite"
      className={`${isDark ? "dark " : ""}pointer-events-none fixed top-4 left-1/2 z-[1500] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col items-center`}
    >
      {rendered.map(({ toast, closing }) => (
        <div
          key={toast.key}
          style={{ transitionDuration: `${EXIT_DURATION_MS}ms` }}
          className={`grid transition-[grid-template-rows,margin] ease-out motion-reduce:transition-none ${
            closing ? "grid-rows-[0fr] mb-0" : "grid-rows-[1fr] mb-2 last:mb-0"
          }`}
        >
          <div className={`min-h-0 px-6 -mx-6 ${closing ? "overflow-hidden" : "overflow-visible"}`}>
            <div
              role={toast.type === "error" ? "alert" : "status"}
              onMouseEnter={closing ? undefined : () => message.pause(toast.key)}
              onMouseLeave={closing ? undefined : () => message.resume(toast.key)}
              className={`flex items-center gap-2.5 rounded-lg border border-border bg-popover px-3.5 py-2 text-sm text-popover-foreground shadow-lg dark:border-[#4b5563] dark:bg-[#2d333b] dark:shadow-[0_8px_24px_rgba(0,0,0,0.55)] motion-reduce:animate-none ${
                closing
                  ? "pointer-events-none animate-toast-out"
                  : "pointer-events-auto animate-toast-in"
              }`}
            >
              <ToastIcon type={toast.type} />
              <div className="min-w-0 break-words leading-snug">{toast.content}</div>
            </div>
          </div>
        </div>
      ))}
    </div>,
    document.body
  )
}
