'use client'

import { useEffect, useState } from 'react'
import type { MathPart as MathPartModel } from '@/lib/chat/parts'
import { PartStatusBox } from './status-box'

export function MathPart({ part }: { part: MathPartModel }) {
  const [html, setHtml] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const displayMode = Boolean(part.display)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const katexMod = await import('katex')
        const katex = katexMod.default
        const rendered = katex.renderToString(part.latex, {
          displayMode,
          throwOnError: false,
          output: 'html',
        })
        if (cancelled) return
        setError(null)
        setHtml(rendered)
      } catch (err) {
        if (cancelled) return
        setHtml('')
        setError(err instanceof Error ? err.message : 'Failed to render math')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [part.latex, displayMode])

  if (error) {
    return <PartStatusBox>{error}</PartStatusBox>
  }

  if (!html) {
    return (
      <div data-testid="math-part" className="my-2 text-xs text-[var(--color-pib-text-muted)]">
        Rendering math…
      </div>
    )
  }

  const Tag = displayMode ? 'div' : 'span'
  return (
    <Tag
      data-testid="math-part"
      className={displayMode ? 'my-2 overflow-x-auto py-1' : 'inline-block align-middle'}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
