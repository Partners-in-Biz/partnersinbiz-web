'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui/AppFoundation'

import { Icon } from '@/components/studio'

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
    <div className="mx-auto max-w-7xl space-y-6" data-module-accent="cyan">
      <PageHeader
        accent="cyan"
        eyebrow={eyebrow}
        title={title}
        description={summary}
        actions={
          payload?.actions?.length ? (
            <>
              {payload.actions.map((action) => (
                <Link key={`${action.href}-${action.label}`} href={action.href} className="pib-btn-primary btn-pib-sm">
                  {action.label}
                </Link>
              ))}
            </>
          ) : null
        }
      />

      {loading ? (
        <div className="pib-card p-4 text-sm text-[var(--color-pib-text-muted)]">Loading operator data...</div>
      ) : error ? (
        <div className="pib-card border border-red-500/30 bg-red-500/5 p-4 text-sm text-[var(--st-danger)]">{error}</div>
      ) : null}

      {!loading && !error && payload ? (
        <>
          {payload.metrics.length ? (
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {payload.metrics.map((metric) => (
                <div key={metric.label} className="pib-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">{metric.label}</p>
                    <span aria-hidden="true" className="!h-6 !w-6 !rounded-md">
                      <Icon name="insights" className="text-[14px]" />
                    </span>
                  </div>
                  <p className="mt-2 text-xl font-medium text-[var(--color-pib-text)]">{metric.value}</p>
                  {metric.helper ? <p className="mt-1.5 text-xs text-[var(--color-pib-text-muted)]">{metric.helper}</p> : null}
                </div>
              ))}
            </section>
          ) : null}

          {payload.callouts?.length ? (
            <section className="grid gap-3 lg:grid-cols-2">
              {payload.callouts.map((callout) => (
                <div
                  key={`${callout.title}-${callout.body}`}
                  className={`pib-card p-4 ${callout.tone === 'warn' ? 'border border-amber-400/30 bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)]' : ''}`}
                >
                  <h2 className="text-base font-medium text-[var(--color-pib-text)]">{callout.title}</h2>
                  <p className="mt-1.5 text-sm text-[var(--color-pib-text-muted)]">{callout.body}</p>
                  {callout.href && callout.hrefLabel ? (
                    <Link href={callout.href} className="mt-3 inline-flex text-sm text-[var(--color-pib-accent)] hover:underline">
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
                <h2 className="text-lg font-medium text-[var(--color-pib-text)]">{section.title}</h2>
                {section.description ? <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">{section.description}</p> : null}
              </div>

              {section.rows.length === 0 ? (
                <div className="px-5 py-8 text-sm text-[var(--color-pib-text-muted)]">
                  {section.emptyMessage ?? 'No records found.'}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="border-b border-[var(--color-pib-line)] text-left text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
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
                            <td key={`${row.id}-${index}`} className="px-5 py-3 text-sm text-[var(--color-pib-text)]">
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
                              )) ?? <span className="text-xs text-[var(--color-pib-text-muted)]">No actions</span>}
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
