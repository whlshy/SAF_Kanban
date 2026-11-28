import React from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import {
  Check as CheckIcon,
  Close as CloseIcon,
  ContentCopy as CopyIcon,
} from '@mui/icons-material'
import { useT } from '@/i18n'
import { fetchLocalAttachmentUrl, localAvailable } from '@/data/localApi'
import { isSafeUrl, parseAttachmentFilename, safeUrlTransform } from '@/lib/markdown'

const MermaidBlock = React.lazy(() => import('./MermaidBlock'))
const REMARK_PLUGINS = [remarkGfm, remarkBreaks]

function extractCodeText(children) {
  if (typeof children === "string") return children
  if (Array.isArray(children)) return children.map(extractCodeText).join("")
  if (React.isValidElement(children)) return extractCodeText(children.props?.children)
  return ""
}

function getMermaidCode(children) {
  const onlyChild = Array.isArray(children) ? children[0] : children
  if (!React.isValidElement(onlyChild)) return null
  const className = String(onlyChild.props?.className || "")
  if (!/(^|\s)language-mermaid(\s|$)/i.test(className)) return null
  return extractCodeText(onlyChild.props?.children).replace(/\n$/, "")
}

function CodeBlock({ children, ...props }) {
  const t = useT()
  const [copied, setCopied] = React.useState(false)
  const timerRef = React.useRef(null)

  React.useEffect(() => () => clearTimeout(timerRef.current), [])

  const handleCopy = async () => {
    const code = extractCodeText(children).replace(/\n$/, "")
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard may be unavailable in non-HTTPS contexts; ignore silently.
    }
  }

  return (
    <div className="group relative my-3">
      <pre {...props}>{children}</pre>
      <button
        type="button"
        onClick={handleCopy}
        title={copied ? t("connection.copied") : t("task.copyCode")}
        aria-label={copied ? t("connection.copied") : t("task.copyCode")}
        className="absolute right-2 top-2 flex size-7 items-center justify-center rounded border border-border/80 bg-background/85 text-muted-foreground opacity-0 backdrop-blur-xs transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 dark:border-white/15 dark:bg-[#1c2128]/90"
      >
        {copied ? <CheckIcon sx={{ fontSize: 14 }} /> : <CopyIcon sx={{ fontSize: 14 }} />}
      </button>
    </div>
  )
}

function ImageLightbox({ src, alt, onClose }) {
  const t = useT()

  React.useEffect(() => {
    // Capture Escape before MUI Dialog's listener so closing the lightbox
    // doesn't also dismiss the underlying task dialog.
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [onClose])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt || t("task.imageLightbox")}
      data-slot="image-lightbox"
      onClick={onClose}
      className="fixed inset-0 z-[1500] flex flex-col items-center justify-center bg-black/80 p-4 backdrop-blur-xs"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t("task.closeLightbox")}
        title={t("task.closeLightbox")}
        className="fixed right-4 top-4 flex size-9 items-center justify-center rounded-full bg-black/60 text-white/90 transition-colors hover:bg-black/85 hover:text-white"
      >
        <CloseIcon fontSize="small" />
      </button>
      <img
        src={src}
        alt={alt || ""}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
      />
      {alt && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="mt-3 max-w-[85vw] truncate rounded-full bg-black/60 px-3 py-1 text-xs text-white/85"
        >
          {alt}
        </div>
      )}
    </div>,
    document.body
  )
}

function MarkdownImage({ src, alt, boardId, onPreview, ...props }) {
  const t = useT()
  const attachmentName = parseAttachmentFilename(src)
  const externalSafe = !attachmentName && isSafeUrl(src, { allowMailto: false })
  const [resolvedUrl, setResolvedUrl] = React.useState(() => (externalSafe ? src : ""))
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    setFailed(false)
    if (externalSafe) {
      setResolvedUrl(src)
      return
    }
    if (!attachmentName) {
      setResolvedUrl("")
      return
    }
    if (!localAvailable() || !boardId) {
      setResolvedUrl("")
      setFailed(true)
      return
    }
    let cancelled = false
    setResolvedUrl("")
    fetchLocalAttachmentUrl(boardId, attachmentName)
      .then((blobUrl) => {
        if (!cancelled) setResolvedUrl(blobUrl)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => { cancelled = true }
  }, [src, attachmentName, externalSafe, boardId])

  if (!attachmentName && !externalSafe) {
    return <span>{alt || src || ""}</span>
  }
  if (failed) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground dark:border-white/15">
        {t("task.imageUnavailable", { name: alt || attachmentName || src })}
      </span>
    )
  }
  if (!resolvedUrl) {
    return (
      <span className="my-2 inline-block h-24 w-40 animate-pulse rounded-md border border-border bg-muted/60 dark:border-white/15" />
    )
  }
  return (
    <img
      {...props}
      src={resolvedUrl}
      alt={alt || ""}
      loading="lazy"
      title={t("task.zoomImage")}
      onClick={() => onPreview({ src: resolvedUrl, alt: alt || "" })}
      onError={() => setFailed(true)}
      className="my-2 max-w-full h-auto cursor-zoom-in rounded-md border border-border transition-opacity hover:opacity-95 dark:border-white/15"
    />
  )
}

export default function MarkdownRenderer({ text, boardId, className = "" }) {
  const [lightbox, setLightbox] = React.useState(null)

  const components = React.useMemo(() => ({
    a({ href, children, ...props }) {
      if (!isSafeUrl(href, { allowMailto: true })) {
        return <span>{children}</span>
      }
      return (
        <a
          {...props}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {children}
        </a>
      )
    },
    img(props) {
      return <MarkdownImage {...props} boardId={boardId} onPreview={setLightbox} />
    },
    table({ children, ...props }) {
      return (
        <div className="my-3 overflow-x-auto">
          <table {...props}>{children}</table>
        </div>
      )
    },
    pre({ children, ...props }) {
      const mermaidCode = getMermaidCode(children)
      if (mermaidCode !== null) {
        return (
          <React.Suspense fallback={<pre {...props}>{children}</pre>}>
            <MermaidBlock code={mermaidCode} />
          </React.Suspense>
        )
      }
      return <CodeBlock {...props}>{children}</CodeBlock>
    },
    input({ type, checked, ...props }) {
      if (type !== "checkbox") return <input type={type} {...props} />
      const isChecked = Boolean(checked)
      return (
        <span
          role="checkbox"
          aria-checked={isChecked}
          aria-disabled="true"
          className={`mr-2 inline-flex size-3.5 items-center justify-center rounded-[3px] border align-middle -translate-y-px ${
            isChecked
              ? "border-blue-600 bg-blue-600 text-white dark:border-[#58a6ff] dark:bg-[#58a6ff] dark:text-[#0d1117]"
              : "border-zinc-400 bg-transparent dark:border-zinc-500"
          }`}
        >
          {isChecked && <CheckIcon sx={{ fontSize: 11, strokeWidth: 2.5 }} />}
        </span>
      )
    },
  }), [boardId])

  return (
    <>
      <div
        data-slot="markdown-content"
        className={`markdown-body prose prose-sm dark:prose-invert max-w-none break-words ${className}`.trim()}
      >
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          urlTransform={safeUrlTransform}
          components={components}
        >
          {text}
        </ReactMarkdown>
      </div>
      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          alt={lightbox.alt}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  )
}
