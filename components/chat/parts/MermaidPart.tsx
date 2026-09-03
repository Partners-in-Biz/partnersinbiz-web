'use client'

import { useEffect, useId, useState } from 'react'
import type { MermaidPart as MermaidPartModel } from '@/lib/chat/parts'
import { sanitizeInlineSvg } from '@/lib/chat/sanitize-svg'
import { PartStatusBox } from './status-box'

export function MermaidPart({ part }: { part: MermaidPartModel }) {
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, '')
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const renderId = `mermaid-${reactId}-${Date.now().toString(36)}`
    void (async () => {
      try {
        const mermaidMod = await import('mermaid')
        const mermaid = mermaidMod.default
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
        const result = await mermaid.render(renderId, part.source)
        if (cancelled) return
        const safe = sanitizeInlineSvg(result.svg)
        if (!safe) {
          setError('Diagram SVG failed sanitizer checks')
          setSvg(null)
          return
        }
        setError(null)
        setSvg(safe)
      } catch (err) {
        if (cancelled) return
        setSvg(null)
        setError(err instanceof Error ? err.message : 'Failed to render diagram')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [part.source, reactId])

  if (error) {
    return (
      <div data-testid="mermaid-part" className="my-2 overflow-hidden rounded-[6px] border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)]">
        {part.title && (
          <div className="border-b border-[var(--color-pib-line)] px-3 py-2 text-xs font-medium text-[var(--color-pib-text)]">
            {part.title}
          </div>
        )}
        <PartStatusBox>{error}</PartStatusBox>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs text-[var(--color-pib-text-muted)] [overflow-wrap:anywhere]">
          <code>{part.source}</code>
        </pre>
      </div>
    )
  }

  return (
    <div
      data-testid="mermaid-part"
      role="img"
      aria-label={part.title || 'Mermaid diagram'}
      className="my-2 overflow-auto rounded-[6px] border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-3"
    >
      {part.title && (
        <div className="mb-2 text-xs font-medium text-[var(--color-pib-text)]">{part.title}</div>
      )}
      {svg ? (
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <p className="text-xs text-[var(--color-pib-text-muted)]">Rendering diagram…</p>
      )}
    </div>
  )
}
