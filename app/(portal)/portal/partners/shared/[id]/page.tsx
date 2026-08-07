'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

interface SharedView {
  share: {
    id: string
    resourceType: string
    resourceId: string
    resourceTitle?: string
    permission: string
  }
  ownerOrgName: string
  record: Record<string, unknown>
}

function unwrap(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  return (b.data as Record<string, unknown>) ?? b
}

const HIDDEN_FIELDS = new Set(['id'])

function humanise(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim()
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`
  if (typeof value === 'object') {
    const ts = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
    const seconds = ts.seconds ?? ts._seconds
    if (typeof seconds === 'number') return new Date(seconds * 1000).toLocaleString()
  }
  return JSON.stringify(value)
}

export default function SharedRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [view, setView] = useState<SharedView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/crm/partner-shares/${id}`)
      const data = unwrap(await res.json().catch(() => null))
      if (!res.ok) {
        setError((data?.error as string) || 'This record is not available.')
        return
      }
      setView(data as unknown as SharedView)
    } catch {
      setError('This record is not available.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { void load() }, [load])

  const lineItems = Array.isArray(view?.record.lineItems)
    ? view!.record.lineItems as Array<Record<string, unknown>>
    : null

  return (
    <div className="space-y-4 p-4">
      <Link href="/portal/partners" className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]">
        ← Back to partners
      </Link>

      {loading ? (
        <p className="text-sm text-[var(--color-pib-text-muted)]">Loading…</p>
      ) : error ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4">
          <h1 className="text-sm font-semibold text-rose-200">Not available</h1>
          <p className="mt-1 text-sm text-rose-300/90">{error}</p>
        </div>
      ) : view ? (
        <>
          <header>
            <p className="eyebrow">Shared by {view.ownerOrgName}</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-[var(--color-pib-text)]">
              {view.share.resourceTitle || view.share.resourceId}
            </h1>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
              {view.share.resourceType.replace('_', ' ')} · read-only · shared with your workspace
            </p>
          </header>

          <section className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] p-4">
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {Object.entries(view.record)
                .filter(([key]) => !HIDDEN_FIELDS.has(key) && key !== 'lineItems')
                .map(([key, value]) => (
                  <div key={key} className="min-w-0">
                    <dt className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">
                      {humanise(key)}
                    </dt>
                    <dd className="truncate text-sm text-[var(--color-pib-text)]">{renderValue(value)}</dd>
                  </div>
                ))}
            </dl>
          </section>

          {lineItems && lineItems.length > 0 ? (
            <section className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] p-4">
              <h2 className="mb-3 text-sm font-semibold text-[var(--color-pib-text)]">Line items</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-pib-line)] text-left text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">
                      <th className="pb-2 pr-3">Description</th>
                      <th className="pb-2 pr-3">Qty</th>
                      <th className="pb-2">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((item, i) => (
                      <tr key={i} className="border-b border-[var(--color-pib-line)] last:border-0">
                        <td className="py-2 pr-3 text-[var(--color-pib-text)]">{renderValue(item.description ?? item.name)}</td>
                        <td className="py-2 pr-3 text-[var(--color-pib-text-muted)]">{renderValue(item.quantity)}</td>
                        <td className="py-2 text-[var(--color-pib-text-muted)]">{renderValue(item.total ?? item.amount ?? item.unitPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
