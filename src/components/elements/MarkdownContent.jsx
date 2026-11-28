import React from 'react'

const MarkdownRenderer = React.lazy(() => import('./MarkdownRenderer'))

/**
 * Lazy-loaded Markdown display component. While the `markdown` chunk loads on
 * first open, falls back to plain pre-wrapped text with zero layout jump.
 */
export default function MarkdownContent({ text = "", className = "" }) {
  const value = String(text ?? "")
  if (!value) return null

  return (
    <React.Suspense
      fallback={
        <div className={`whitespace-pre-wrap break-words text-sm ${className}`.trim()}>
          {value}
        </div>
      }
    >
      <MarkdownRenderer text={value} className={className} />
    </React.Suspense>
  )
}
