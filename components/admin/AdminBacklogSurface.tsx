'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type SurfaceMetric = {
  label: string
  value: string
  helper?: string
}

type SurfaceAction = {
  label: string
  href: string
}

type SurfaceRow = {
  id: string
  cells: string[]
  href?: string
  actions?: SurfaceAction[]
}

type SurfaceSection = {
  title: string
  description?: string
  columns: string[]
  rows: SurfaceRow[]
  emptyMessage?: string
}

type SurfaceCallout = {
  title: string
  body: string
  tone?: 'default' | 'warn'
  href?: string
  hrefLabel?: string
}

type SurfacePayload = {
  metrics: SurfaceMetric[]
  sections: SurfaceSection[]
  actions?: SurfaceAction[]
  callouts?: SurfaceCallout[]
}

function unwrap<T>(body: unknown): T | null {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    return ((body as { data: T }).data) ?? null
  }
  return (body as T) ?? null
}

export function AdminBacklogSurface({
  endpoint,
  eyebrow,
  title,
  summary,
}: {
  endpoint: string
  eyebrow: string
  title: string
  summary: string
}) {
  const [payload, setPayload] = useState<SurfacePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    fetch(endpoint, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        const data = unwrap<SurfacePayload>(body)
        if (!res.ok) throw new Error((body as { error?: string }).error ?? 'Failed to load admin surface')
        if (!cancelled) setPayload(data)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load admin surface')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [endpoint])

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="pib-card p-6">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="pib-page-title mt-2">{title}</h1>
        <p className="mt-3 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">{summary}</p>

        {payload?.actions?.length ? (
          <div className="mt-5 flex flex-wrap gap-3">
            {payload.actions.map((action) => (
              <Link key={`${action.href}-${action.label}`} href={action.href} className="pib-btn-primary">
                {action.label}
              </Link>
            ))}
          </div>
        ) : null}
      </header>

      {loading ? (
        <div className="pib-card p-8 text-sm text-[var(--color-pib-text-muted)]">Loading operator data...</div>
      ) : error ? (
        <div className="pib-card border border-red-500/30 bg-red-500/5 p-5 text-sm text-red-400">{error}</div>
      ) : null}

      {!loading && !error && payload ? (
        <>
          {payload.metrics.length ? (
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {payload.metrics.map((metric) => (
                <div key={metric.label} className="pib-card p-5">
                  <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{metric.label}</p>
                  <p className="mt-3 text-2xl font-semibold text-on-surface">{metric.value}</p>
                  {metric.helper ? <p className="mt-2 text-xs text-on-surface-variant">{metric.helper}</p> : null}
                </div>
              ))}
            </section>
          ) : null}

          {payload.callouts?.length ? (
            <section className="grid gap-4 lg:grid-cols-2">
              {payload.callouts.map((callout) => (
                <div
                  key={`${callout.title}-${callout.body}`}
                  className={`pib-card p-5 ${callout.tone === 'warn' ? 'border border-amber-400/30 bg-amber-400/10' : ''}`}
                >
                  <h2 className="text-lg font-semibold text-on-surface">{callout.title}</h2>
                  <p className="mt-2 text-sm text-on-surface-variant">{callout.body}</p>
                  {callout.href && callout.hrefLabel ? (
                    <Link href={callout.href} className="mt-4 inline-flex text-sm text-[var(--color-pib-accent)] hover:underline">
                      {callout.hrefLabel}
                    </Link>
                  ) : null}
                </div>
              ))}
            </section>
          ) : null}

          {payload.sections.map((section) => (
            <section key={section.title} className="pib-card overflow-hidden">
              <div className="border-b border-[var(--color-pib-line)] px-5 py-4">
                <h2 className="text-lg font-semibold text-on-surface">{section.title}</h2>
                {section.description ? <p className="mt-1 text-sm text-on-surface-variant">{section.description}</p> : null}
              </div>

              {section.rows.length === 0 ? (
                <div className="px-5 py-8 text-sm text-on-surface-variant">
                  {section.emptyMessage ?? 'No records found.'}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="border-b border-[var(--color-pib-line)] text-left text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                        {section.columns.map((column) => (
                          <th key={column} className="px-5 py-3">{column}</th>
                        ))}
                        <th className="px-5 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.rows.map((row) => (
                        <tr key={row.id} className="border-b border-[var(--color-pib-line)]/60 align-top last:border-b-0">
                          {row.cells.map((cell, index) => (
                            <td key={`${row.id}-${index}`} className="px-5 py-3 text-sm text-on-surface">
                              {index === 0 && row.href ? (
                                <Link href={row.href} className="font-medium text-[var(--color-pib-accent)] hover:underline">
                                  {cell}
                                </Link>
                              ) : (
                                <span>{cell}</span>
                              )}
                            </td>
                          ))}
                          <td className="px-5 py-3">
                            <div className="flex flex-wrap gap-2">
                              {row.actions?.map((action) => (
                                <Link key={`${row.id}-${action.href}-${action.label}`} href={action.href} className="pib-pill">
                                  {action.label}
                                </Link>
                              )) ?? <span className="text-xs text-on-surface-variant">No actions</span>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </>
      ) : null}
    </div>
  )
}

export default AdminBacklogSurface
