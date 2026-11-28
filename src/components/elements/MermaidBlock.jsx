import React from 'react'
import {
  AccountTreeOutlined as DiagramIcon,
  Check as CheckIcon,
  Code as CodeIcon,
  ContentCopy as CopyIcon,
} from '@mui/icons-material'
import { useT } from '@/i18n'
import { useTheme } from '@/store/theme'

let mermaidPromise = null
let renderQueue = Promise.resolve()
let nextDiagramId = 0

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => mod.default || mod)
  }
  return mermaidPromise
}

function renderMermaidSvg(code, isDark) {
  const job = renderQueue.then(async () => {
    const mermaid = await loadMermaid()
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: isDark ? 'dark' : 'default',
      fontFamily: "'Noto Sans TC', sans-serif",
      themeVariables: isDark
        ? {
            darkMode: true,
            background: '#15191f',
            primaryColor: '#253041',
            primaryTextColor: '#e6edf3',
            primaryBorderColor: '#58a6ff',
            lineColor: '#8b949e',
            secondaryColor: '#1c2128',
            tertiaryColor: '#15191f',
          }
        : undefined,
    })

    const id = `saf-mermaid-${++nextDiagramId}`
    try {
      const result = await mermaid.render(id, code)
      return typeof result === 'string' ? result : (result?.svg || '')
    } finally {
      // Remove any stray temporary container Mermaid leaves in the DOM on error.
      const stray = document.getElementById(`d${id}`)
      if (stray) stray.remove()
    }
  })

  // Keep the queue alive even if one diagram has a syntax error.
  renderQueue = job.catch(() => {})
  return job
}

export default function MermaidBlock({ code = '' }) {
  const t = useT()
  const { isDark } = useTheme()
  const [state, setState] = React.useState({ status: 'loading', svg: '', error: '' })
  const [showCode, setShowCode] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const copyTimerRef = React.useRef(null)

  React.useEffect(() => () => clearTimeout(copyTimerRef.current), [])

  React.useEffect(() => {
    const trimmed = String(code ?? '').trim()
    if (!trimmed) {
      setState({ status: 'error', svg: '', error: t('task.mermaidEmpty') })
      return
    }

    let cancelled = false
    setState((prev) => ({ status: 'loading', svg: prev.svg, error: '' }))

    renderMermaidSvg(trimmed, isDark)
      .then((svg) => {
        if (cancelled) return
        if (!svg || !svg.trim().startsWith('<svg')) {
          setState({ status: 'error', svg: '', error: t('task.mermaidError') })
        } else {
          setState({ status: 'ready', svg, error: '' })
        }
      })
      .catch((err) => {
        if (cancelled) return
        const detail = String(err?.str || err?.message || '').split('\n')[0].trim()
        setState({ status: 'error', svg: '', error: detail || t('task.mermaidError') })
      })

    return () => { cancelled = true }
  }, [code, isDark, t])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 1600)
    } catch {
      // Ignore clipboard failures in restricted contexts.
    }
  }

  return (
    <div
      data-slot="mermaid-block"
      className="group relative my-3 overflow-hidden rounded-lg border border-border bg-[#f6f8fa] dark:border-white/12 dark:bg-[#15191f]"
    >
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1 opacity-75 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {state.status === 'ready' && (
          <button
            type="button"
            onClick={() => setShowCode((v) => !v)}
            title={showCode ? t('task.mermaidShowDiagram') : t('task.mermaidShowCode')}
            aria-label={showCode ? t('task.mermaidShowDiagram') : t('task.mermaidShowCode')}
            className="flex size-7 items-center justify-center rounded border border-border/80 bg-background/90 text-muted-foreground backdrop-blur-xs hover:text-foreground dark:border-white/15 dark:bg-[#1c2128]/90"
          >
            {showCode ? <DiagramIcon sx={{ fontSize: 15 }} /> : <CodeIcon sx={{ fontSize: 15 }} />}
          </button>
        )}
        <button
          type="button"
          onClick={handleCopy}
          title={copied ? t('connection.copied') : t('task.copyCode')}
          aria-label={copied ? t('connection.copied') : t('task.copyCode')}
          className="flex size-7 items-center justify-center rounded border border-border/80 bg-background/90 text-muted-foreground backdrop-blur-xs hover:text-foreground dark:border-white/15 dark:bg-[#1c2128]/90"
        >
          {copied ? <CheckIcon sx={{ fontSize: 14 }} /> : <CopyIcon sx={{ fontSize: 14 }} />}
        </button>
      </div>

      {showCode ? (
        <pre className="!my-0 !border-0 !rounded-none">
          <code>{code}</code>
        </pre>
      ) : state.status === 'error' ? (
        <div>
          <div className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 pr-20 text-xs text-amber-800 dark:text-amber-300">
            <span className="font-medium">{t('task.mermaidError')}</span>
            {state.error && state.error !== t('task.mermaidError') && (
              <span className="ml-1.5 opacity-85">— {state.error}</span>
            )}
          </div>
          <pre className="!my-0 !border-0 !rounded-none">
            <code>{code}</code>
          </pre>
        </div>
      ) : state.svg ? (
        <div
          data-slot="mermaid-svg"
          className="mermaid-diagram flex justify-center overflow-x-auto p-4 pt-5"
          // SVG is produced and sanitized by Mermaid in strict securityLevel mode.
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
      ) : (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          {t('task.mermaidLoading')}
        </div>
      )}
    </div>
  )
}
