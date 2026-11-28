import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { Check as CheckIcon, ContentCopy as CopyIcon } from '@mui/icons-material'
import { useT } from '@/i18n'
import { isSafeUrl, safeUrlTransform } from '@/lib/markdown'

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

const COMPONENTS = {
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
  img({ src, alt, ...props }) {
    if (!isSafeUrl(src, { allowMailto: false })) {
      return <span>{alt || src || ""}</span>
    }
    return (
      <img
        {...props}
        src={src}
        alt={alt || ""}
        loading="lazy"
        className="my-2 max-w-full h-auto rounded-md border border-border dark:border-white/15"
      />
    )
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
        <React.Suspense
          fallback={
            <pre {...props}>{children}</pre>
          }
        >
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
}

export default function MarkdownRenderer({ text, className = "" }) {
  return (
    <div
      data-slot="markdown-content"
      className={`markdown-body prose prose-sm dark:prose-invert max-w-none break-words ${className}`.trim()}
    >
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        urlTransform={safeUrlTransform}
        components={COMPONENTS}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
