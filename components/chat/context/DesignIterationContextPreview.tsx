'use client'

/**
 * Design Iteration ("Design this page") canvas preview - Context Dock
 * side-panel for a `design` context reference whose id is a design-iteration
 * session (`di_`-prefixed). Loads the session through the chat-context API
 * (tenant-scoped server-side) and shows the variant deck: baseline URL,
 * instruction, one group per variant with archetype + status, decision
 * attention, and the apply/detector summary when applied.
 */

import { useEffect, useState } from 'react'

export interface DesignIterationPreviewData {
  context?: {
    kind?: string
    id?: string
    orgId?: string
    label?: string
  }
  pulse?: {
    label?: string
    metrics?: Array<{ id?: string; label?: string; value?: string | number }>
    headline?: string
    next?: { id?: string; label?: string; state?: string; detail?: string }
  }
  groups?: Array<{
    id?: string
    label?: string
    items?: Array<{ id?: string; label?: string; state?: string; detail?: string }>
  }>
  attention?: Array<{ id?: string; label?: string; state?: string; detail?: string }>
  preview?: { kind?: string; text?: string; status?: string }
}

function stateTone(state: string | undefined): string {
  if (state === 'blocked') return 'border-red-400/30 bg-red-500/10 text-red-100'
  if (state === 'needs_input') return 'border-amber-400/30 bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)] text-[var(--st-warning)]'
  if (state === 'complete') return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
  return 'border-sky-400/30 bg-sky-500/10 text-sky-100'
}

export function DesignIterationContextPreview({ iterationId, refreshRevision = 0 }: { iterationId: string; refreshRevision?: number }) {
  const [data, setData] = useState<DesignIterationPreviewData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setData(null)
    setError(null)
    fetch(`/api/v1/chat-context/design/${encodeURIComponent(iterationId)}`, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Design iteration unavailable (${response.status})`)
        const body = await response.json().catch(() => null) as { data?: DesignIterationPreviewData } | null
        if (!body?.data) throw new Error('Design iteration unavailable')
        return body.data
      })
      .then((model) => { if (active) setData(model) })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : 'Design iteration unavailable') })
    return () => { active = false }
  }, [iterationId, refreshRevision])

  if (error) {
    return (
      <div role="alert" className="rounded-[6px] border border-amber-400/30 bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)] p-3 text-xs text-[var(--st-warning)]">
        {error}
      </div>
    )
  }
  if (!data) {
    return (
      <div role="status" className="rounded-[6px] border border-[var(--color-card-border)] p-3 text-xs text-[var(--color-pib-text-muted)]">
        Loading variant deck…
      </div>
    )
  }

  const headline = data.pulse?.headline || data.context?.label || 'Design this page'
  const metrics = data.pulse?.metrics ?? []
  const groups = (data.groups ?? []).filter((group) => group.label && (group.items?.length ?? 0) > 0)
  const attention = data.attention ?? []
  const previewStatus = data.preview?.status

  return (
    <section aria-label="Design this page" data-testid="design-iteration-context-preview" className="space-y-3">
      <div className="rounded-[6px] border border-primary/20 bg-primary/[0.05] p-3">
        <p className="text-[9px] font-label uppercase tracking-[0.18em] text-primary">Design this page</p>
        <h3 className="mt-0.5 break-words text-sm font-medium text-[var(--color-pib-text)] [overflow-wrap:anywhere]">{headline}</h3>
        {data.preview?.text && <p className="mt-1 text-xs leading-relaxed text-[var(--color-pib-text-muted)]">{data.preview.text}</p>}
        {previewStatus && (
          <span className={`mt-2 inline-block rounded-[4px] border px-2 py-0.5 text-[10px] font-medium ${stateTone(previewStatus)}`}>
            {previewStatus}
          </span>
        )}
      </div>

      {metrics.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {metrics.map((metric) => (
            <div key={metric.id ?? metric.label ?? metric.value ?? 'metric'} className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] px-2 py-1.5 text-center">
              <p className="text-[9px] font-label uppercase tracking-wide text-[var(--color-pib-text-muted)]">{metric.label}</p>
              <p className="mt-0.5 text-sm font-medium tabular-nums text-[var(--color-pib-text)]">{String(metric.value ?? '')}</p>
            </div>
          ))}
        </div>
      )}

      {attention.length > 0 && (
        <div className="space-y-2">
          {attention.map((item) => (
            <div key={item.id ?? item.label} className={`rounded-lg border px-2.5 py-2 text-xs ${stateTone(item.state)}`}>
              <p className="font-medium">{item.label}</p>
              {item.detail && <p className="mt-0.5 opacity-90 line-clamp-3">{item.detail}</p>}
            </div>
          ))}
        </div>
      )}

      {groups.map((group) => (
        <section key={group.id ?? group.label}>
          <h4 className="mb-1.5 text-[10px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">{group.label}</h4>
          <ul className="space-y-1.5">
            {(group.items ?? []).slice(0, 12).map((item) => (
              <li key={item.id ?? `${group.id}-${item.label}`} className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] px-2.5 py-1.5 text-[11px]">
                <p className="font-medium text-[var(--color-pib-text)]">{item.label}</p>
                {item.detail && <p className="mt-0.5 text-[var(--color-pib-text-muted)] line-clamp-3 [overflow-wrap:anywhere]">{item.detail}</p>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  )
}
