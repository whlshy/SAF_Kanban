import React from 'react'
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
  if (!toasts.length || typeof document === "undefined") return null

  return createPortal(
    <div
      role="region"
      aria-live="polite"
      className={`${isDark ? "dark " : ""}pointer-events-none fixed top-4 left-1/2 z-[1500] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col items-center gap-2`}
    >
      {toasts.map((toast) => (
        <div
          key={toast.key}
          role={toast.type === "error" ? "alert" : "status"}
          onMouseEnter={() => message.pause(toast.key)}
          onMouseLeave={() => message.resume(toast.key)}
          className="pointer-events-auto flex items-center gap-2.5 rounded-lg border border-border bg-popover px-3.5 py-2 text-sm text-popover-foreground shadow-lg dark:border-[#4b5563] dark:bg-[#2d333b] dark:shadow-[0_8px_24px_rgba(0,0,0,0.55)]"
        >
          <ToastIcon type={toast.type} />
          <div className="min-w-0 break-words leading-snug">{toast.content}</div>
        </div>
      ))}
    </div>,
    document.body
  )
}
