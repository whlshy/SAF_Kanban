// Shared helpers for Task Labels: normalization, Google Sheet parsing,
// 10 semantic light/dark color palettes, custom #RRGGBB hex support, and
// deterministic fallback colors for freeform labels.

export const LABEL_PALETTE = {
  red: {
    dot: "#ef4444",
    light: { bg: "#fef2f2", border: "#fecaca", text: "#b91c1c" },
    dark: { bg: "rgba(239, 68, 68, 0.16)", border: "rgba(248, 113, 113, 0.42)", text: "#fca5a5" },
  },
  orange: {
    dot: "#f97316",
    light: { bg: "#fff7ed", border: "#fed7aa", text: "#c2410c" },
    dark: { bg: "rgba(249, 115, 22, 0.16)", border: "rgba(251, 146, 60, 0.42)", text: "#fdba74" },
  },
  amber: {
    dot: "#eab308",
    light: { bg: "#fefce8", border: "#fde68a", text: "#a16207" },
    dark: { bg: "rgba(234, 179, 8, 0.16)", border: "rgba(250, 204, 21, 0.40)", text: "#fde047" },
  },
  green: {
    dot: "#22c55e",
    light: { bg: "#f0fdf4", border: "#bbf7d0", text: "#15803d" },
    dark: { bg: "rgba(34, 197, 94, 0.16)", border: "rgba(74, 222, 128, 0.40)", text: "#86efac" },
  },
  teal: {
    dot: "#14b8a6",
    light: { bg: "#f0fdfa", border: "#99f6e4", text: "#0f766e" },
    dark: { bg: "rgba(20, 184, 166, 0.16)", border: "rgba(45, 212, 191, 0.40)", text: "#5eead4" },
  },
  blue: {
    dot: "#3b82f6",
    light: { bg: "#eff6ff", border: "#bfdbfe", text: "#1d4ed8" },
    dark: { bg: "rgba(59, 130, 246, 0.18)", border: "rgba(96, 165, 250, 0.42)", text: "#93c5fd" },
  },
  indigo: {
    dot: "#6366f1",
    light: { bg: "#eef2ff", border: "#c7d2fe", text: "#4338ca" },
    dark: { bg: "rgba(99, 102, 241, 0.18)", border: "rgba(129, 140, 248, 0.42)", text: "#a5b4fc" },
  },
  purple: {
    dot: "#a855f7",
    light: { bg: "#faf5ff", border: "#e9d5ff", text: "#7e22ce" },
    dark: { bg: "rgba(168, 85, 247, 0.18)", border: "rgba(192, 132, 252, 0.42)", text: "#d8b4fe" },
  },
  pink: {
    dot: "#ec4899",
    light: { bg: "#fdf2f8", border: "#fbcfe8", text: "#be185d" },
    dark: { bg: "rgba(236, 72, 153, 0.16)", border: "rgba(244, 114, 182, 0.42)", text: "#f9a8d4" },
  },
  gray: {
    dot: "#6b7280",
    light: { bg: "#f4f4f5", border: "#d4d4d8", text: "#3f3f46" },
    dark: { bg: "rgba(148, 163, 184, 0.16)", border: "rgba(148, 163, 184, 0.38)", text: "#cbd5e1" },
  },
}

export const LABEL_COLOR_KEYS = Object.keys(LABEL_PALETTE)
const HASH_COLOR_KEYS = LABEL_COLOR_KEYS.filter((key) => key !== "gray")
const HEX_COLOR_RE = /^#([0-9a-f]{6})$/i

// Normalizes a label list from either an array or a comma-separated string.
// Trims whitespace, splits commas, removes empties, and deduplicates
// case-insensitively while preserving the first-seen casing.
export function parseLabels(input) {
  const raw = Array.isArray(input)
    ? input.flatMap((item) => String(item ?? "").split(","))
    : typeof input === "string"
      ? input.split(",")
      : []
  const result = []
  const seen = new Set()
  for (const part of raw) {
    const clean = part.trim()
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(clean)
  }
  return result
}

export const formatLabels = (labels) => parseLabels(labels).join(", ")

export function normalizeColorValue(color) {
  const clean = String(color ?? "").trim().toLowerCase()
  if (!clean) return ""
  if (LABEL_PALETTE[clean]) return clean
  if (HEX_COLOR_RE.test(clean)) return clean
  return ""
}

// Normalizes board-level label definitions ({ name, color } or plain string).
export function normalizeLabelDefs(defs = []) {
  const result = []
  const seen = new Set()
  for (const item of defs || []) {
    const rawName = typeof item === "string" ? item : item?.name
    const name = String(rawName ?? "").replaceAll(",", " ").trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const color = typeof item === "string" ? "" : normalizeColorValue(item?.color)
    result.push(color ? { name, color } : { name })
  }
  return result
}

// Stable FNV-1a hash mapping any label name to one of the semantic palette keys.
export function hashLabelColor(name) {
  const text = String(name ?? "").trim().toLowerCase()
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return HASH_COLOR_KEYS[Math.abs(hash) % HASH_COLOR_KEYS.length]
}

function hexToRgb(hex) {
  const match = HEX_COLOR_RE.exec(hex)
  if (!match) return null
  const value = parseInt(match[1], 16)
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  }
}

// Returns inline pill colors `{ backgroundColor, borderColor, color }` and `dot`
// for a label name, preferring board-defined color and falling back to hash.
export function resolveLabelStyle(name, boardLabels = [], isDark = false) {
  const target = String(name ?? "").trim().toLowerCase()
  const def = (boardLabels || []).find((item) => String(item?.name ?? "").trim().toLowerCase() === target)
  const specified = normalizeColorValue(def?.color)

  if (specified && HEX_COLOR_RE.test(specified)) {
    const rgb = hexToRgb(specified)
    if (rgb) {
      const { r, g, b } = rgb
      // Mix toward white on dark mode or toward black on light mode for legible text.
      const textColor = isDark
        ? `rgb(${Math.round(r + (255 - r) * 0.45)}, ${Math.round(g + (255 - g) * 0.45)}, ${Math.round(b + (255 - b) * 0.45)})`
        : `rgb(${Math.round(r * 0.65)}, ${Math.round(g * 0.65)}, ${Math.round(b * 0.65)})`
      return {
        dot: specified,
        backgroundColor: `rgba(${r}, ${g}, ${b}, ${isDark ? 0.18 : 0.12})`,
        borderColor: `rgba(${r}, ${g}, ${b}, ${isDark ? 0.45 : 0.35})`,
        color: textColor,
      }
    }
  }

  const key = (specified && LABEL_PALETTE[specified]) ? specified : hashLabelColor(name)
  const palette = LABEL_PALETTE[key]
  const theme = isDark ? palette.dark : palette.light
  return {
    dot: palette.dot,
    backgroundColor: theme.bg,
    borderColor: theme.border,
    color: theme.text,
  }
}

// All label names to offer in filters and pickers: board-defined labels first
// (in their defined order), then any freeform labels found on tasks.
export function labelOptions(boardLabels = [], tasks = []) {
  const result = []
  const seen = new Set()
  const push = (name) => {
    const clean = String(name ?? "").trim()
    if (!clean) return
    const key = clean.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    result.push(clean)
  }
  for (const def of boardLabels || []) {
    push(typeof def === "string" ? def : def?.name)
  }
  for (const task of tasks || []) {
    for (const label of parseLabels(task?.labels)) {
      push(label)
    }
  }
  return result
}
