import React, { useLayoutEffect, useRef, useState } from 'react'
import { Tooltip } from '@mui/material'
import { Close as CloseIcon } from '@mui/icons-material'
import { useTheme } from '@/store/theme'
import { parseLabels, resolveLabelStyle } from '@/lib/labels'

const PILL_GAP = 4

export function LabelBadge({
  name,
  boardLabels = [],
  active = false,
  onClick,
  onRemove,
  size = "sm",
  truncate = false,
  className = "",
}) {
  const { isDark } = useTheme()
  const style = resolveLabelStyle(name, boardLabels, isDark)
  const sizeClass = size === "md"
    ? "h-6 px-2 text-xs gap-1"
    : "h-[20px] px-[7px] text-[11px] gap-0.5"
  const baseClass = `inline-flex items-center rounded-full border font-medium leading-none select-none ${sizeClass} ${truncate ? "min-w-0 max-w-full" : "shrink-0 whitespace-nowrap"} ${active ? "ring-2 ring-current ring-offset-1 dark:ring-offset-[#1f1f1f]" : ""} ${className}`
  const inlineStyle = {
    backgroundColor: style.backgroundColor,
    borderColor: style.borderColor,
    color: style.color,
  }

  if (onClick) {
    return (
      <button
        type="button"
        data-slot="label-badge"
        style={inlineStyle}
        onClick={(e) => {
          e.stopPropagation()
          onClick(name, e)
        }}
        className={`${baseClass} cursor-pointer transition-opacity hover:opacity-85`}
      >
        <span className={truncate ? "truncate" : undefined}>{name}</span>
      </button>
    )
  }

  return (
    <span data-slot="label-badge" style={inlineStyle} className={baseClass}>
      <span className={truncate ? "truncate" : undefined}>{name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove(name)
          }}
          aria-label={`Remove ${name}`}
          className="ml-0.5 -mr-1 inline-flex size-4 items-center justify-center rounded-full opacity-75 hover:opacity-100"
        >
          <CloseIcon sx={{ fontSize: 12 }} />
        </button>
      )}
    </span>
  )
}

// Single-row label list for TaskCard: dynamically measures container width and
// shows as many labels as fit without overflowing, replacing any remaining
// labels with a `+N` badge (tooltip shows the hidden labels).
export function CardLabelsRow({ labels, boardLabels = [], activeLabel = "", onLabelClick }) {
  const items = React.useMemo(() => parseLabels(labels), [labels])
  const containerRef = useRef(null)
  const itemRefs = useRef([])
  const moreOneRef = useRef(null)
  const moreTwoRef = useRef(null)
  const [visibleCount, setVisibleCount] = useState(items.length)
  const activeKey = String(activeLabel ?? "").trim().toLowerCase()

  useLayoutEffect(() => {
    if (!items.length) return
    const container = containerRef.current
    if (!container) return

    const measure = () => {
      const available = container.clientWidth
      if (available <= 0) return

      const widths = items.map((_, i) => itemRefs.current[i]?.offsetWidth || 0)
      const totalWidth = widths.reduce((sum, w) => sum + w, 0) + PILL_GAP * (items.length - 1)
      if (totalWidth <= available) {
        setVisibleCount((prev) => (prev === items.length ? prev : items.length))
        return
      }

      const oneDigitMore = moreOneRef.current?.offsetWidth || 26
      const twoDigitMore = moreTwoRef.current?.offsetWidth || 34
      let fit = 1
      let used = 0
      for (let i = 0; i < items.length; i++) {
        const nextUsed = i === 0 ? widths[i] : used + PILL_GAP + widths[i]
        const remaining = items.length - (i + 1)
        const moreWidth = remaining >= 10 ? twoDigitMore : oneDigitMore
        const needed = remaining > 0 ? nextUsed + PILL_GAP + moreWidth : nextUsed
        if (needed <= available) {
          used = nextUsed
          fit = i + 1
        } else {
          break
        }
      }
      setVisibleCount((prev) => (prev === fit ? prev : fit))
    }

    measure()
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null
    observer?.observe(container)
    let cancelled = false
    document.fonts?.ready?.then(() => {
      if (!cancelled) measure()
    })
    return () => {
      cancelled = true
      observer?.disconnect()
    }
  }, [items])

  if (!items.length) return null

  const shownCount = Math.min(visibleCount, items.length)
  const visible = items.slice(0, shownCount)
  const hidden = items.slice(shownCount)

  return (
    <div ref={containerRef} data-slot="card-labels" className="relative min-w-0 w-full">
      {/* Hidden measurement layer with exact badge typography/padding */}
      <div
        aria-hidden="true"
        className="pointer-events-none invisible absolute left-0 top-0 flex items-center gap-1 whitespace-nowrap"
      >
        {items.map((label, i) => (
          <span
            key={label}
            ref={(el) => { itemRefs.current[i] = el }}
            className="inline-flex h-[20px] items-center rounded-full border px-[7px] text-[11px] font-medium leading-none whitespace-nowrap"
          >
            {label}
          </span>
        ))}
        <span
          ref={moreOneRef}
          className="inline-flex h-[20px] items-center rounded-full border px-1.5 text-[11px] font-medium leading-none tabular-nums whitespace-nowrap"
        >
          +9
        </span>
        <span
          ref={moreTwoRef}
          className="inline-flex h-[20px] items-center rounded-full border px-1.5 text-[11px] font-medium leading-none tabular-nums whitespace-nowrap"
        >
          +99
        </span>
      </div>

      {/* Rendered single row */}
      <div className="flex min-w-0 items-center gap-1 overflow-hidden px-[3px] -mx-[3px] py-[3px] -my-[3px]">
        {visible.map((label) => (
          <LabelBadge
            key={label}
            name={label}
            boardLabels={boardLabels}
            active={Boolean(activeKey && label.toLowerCase() === activeKey)}
            onClick={onLabelClick}
            truncate={shownCount === 1}
          />
        ))}
        {hidden.length > 0 && (
          <Tooltip title={hidden.join(", ")} placement="top">
            <span
              data-slot="card-labels-more"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex h-[20px] shrink-0 items-center rounded-full border border-border bg-muted/80 px-1.5 text-[11px] font-medium leading-none tabular-nums text-muted-foreground dark:border-white/15 dark:bg-white/10"
            >
              +{hidden.length}
            </span>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
