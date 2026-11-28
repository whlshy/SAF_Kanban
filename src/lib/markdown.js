const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"])
const SAFE_IMAGE_PROTOCOLS = new Set(["http:", "https:"])

/**
 * Validates that a URL uses an explicit safe protocol.
 * Blocks `javascript:`, `data:`, `vbscript:`, `file:`, and relative URLs.
 */
export function isSafeUrl(raw, { allowMailto = true } = {}) {
  const trimmed = String(raw ?? "").trim()
  if (!trimmed) return false
  // Reject ASCII control characters that some parsers strip before scheme checks.
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed.charCodeAt(i) <= 0x1f) return false
  }
  try {
    const parsed = new URL(trimmed)
    const allowed = allowMailto ? SAFE_LINK_PROTOCOLS : SAFE_IMAGE_PROTOCOLS
    return allowed.has(parsed.protocol.toLowerCase())
  } catch {
    return false
  }
}

/**
 * `urlTransform` callback for react-markdown: keeps safe external links and
 * drops unsafe schemes so react-markdown renders them inert.
 */
export function safeUrlTransform(url, key) {
  const allowMailto = key !== "src"
  return isSafeUrl(url, { allowMailto }) ? String(url).trim() : ""
}

const TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/

/**
 * Converts Markdown text into clean plain text for compact 2-line previews
 * (task cards and deleted-task history rows).
 */
export function markdownToPlainText(markdown) {
  const raw = String(markdown ?? "")
  if (!raw.trim()) return ""

  const lines = raw.replace(/\r\n?/g, "\n").split("\n")
  const out = []
  let inFence = false
  let fenceChar = ""
  let fenceLen = 0
  let inMermaid = false

  for (const rawLine of lines) {
    const fenceMatch = rawLine.match(/^\s*(`{3,}|~{3,})(.*)$/)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      const info = fenceMatch[2].trim().toLowerCase()
      if (!inFence) {
        inFence = true
        fenceChar = marker[0]
        fenceLen = marker.length
        inMermaid = info === "mermaid" || info.startsWith("mermaid ")
        if (inMermaid) out.push("[Mermaid]")
        continue
      }
      if (marker[0] === fenceChar && marker.length >= fenceLen && rawLine.trim().length === marker.length) {
        inFence = false
        fenceChar = ""
        fenceLen = 0
        inMermaid = false
        continue
      }
    }

    if (inFence) {
      if (inMermaid) continue
      const trimmedCode = rawLine.trim()
      if (trimmedCode) out.push(trimmedCode)
      continue
    }

    // Drop horizontal rules and GFM table alignment separator lines.
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(rawLine)) continue
    if (TABLE_SEP_RE.test(rawLine)) continue

    let line = rawLine

    // Strip blockquote prefixes (`> `, `>> `).
    line = line.replace(/^\s*(?:>\s*)+/, "")

    // Strip ATX heading markers (`## Title ##` -> `Title`).
    line = line.replace(/^\s{0,3}#{1,6}\s+/, "").replace(/\s+#+\s*$/, "")

    // Convert GFM task list items to clean Unicode checkboxes.
    line = line.replace(/^\s*[-*+]\s+\[([ xX])\]\s+/, (_, mark) => (
      mark === " " ? "☐ " : "☑ "
    ))

    // Strip unordered list bullets (`- `, `* `, `+ `).
    line = line.replace(/^\s*[-*+]\s+/, "")

    // Flatten GFM table rows (`| A | B |` -> `A · B`).
    if (/^\s*\|.*\|\s*$/.test(line)) {
      line = line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim())
        .filter(Boolean)
        .join(" · ")
    }

    // Protect backslash-escaped Markdown punctuation so `\*literal\*` isn't
    // stripped as emphasis.
    const escapes = []
    line = line.replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, (_, ch) => {
      escapes.push(ch)
      return `\uE000${escapes.length - 1}\uE001`
    })

    // Images: `![alt](url)` -> `alt`
    line = line.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")

    // Links: `[label](url "title")` -> `label`
    line = line.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")

    // Reference links: `[label][id]` -> `label`
    line = line.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")

    // Autolinks: `<https://example.com>` -> `https://example.com`
    line = line.replace(/<(https?:\/\/[^>]+|mailto:[^>]+)>/gi, (_, url) => url.replace(/^mailto:/i, ""))

    // Inline code: `` `code` `` -> `code`
    line = line.replace(/`+([^`]+)`+/g, "$1")

    // Strikethrough: `~~text~~` -> `text`
    line = line.replace(/~~([\s\S]+?)~~/g, "$1")

    // Bold & italic (`***text***`, `**text**`, `*text*`, `__text__`, `_text_`).
    // Word-boundary guards around `_` avoid mangling `snake_case_names`.
    line = line
      .replace(/\*\*\*([^*]+)\*\*\*/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/(^|[^\w])__([^_]+)__(?=$|[^\w])/g, "$1$2")
      .replace(/\*([^*\n]+)\*/g, "$1")
      .replace(/(^|[^\w])_([^_\n]+)_(?=$|[^\w])/g, "$1$2")

    // Restore escaped punctuation characters.
    if (escapes.length) {
      line = line.replace(/\uE000(\d+)\uE001/g, (_, idx) => escapes[Number(idx)])
    }

    const cleaned = line.trim().replace(/\s+/g, " ")
    if (cleaned) out.push(cleaned)
  }

  return out.join("\n")
}
