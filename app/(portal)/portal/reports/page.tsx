'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface PortalReport {
  id: string
  type: string
  period: { start: string; end: string }
  status: string
  publicToken: string | null
  kpis: { total_revenue: number; mrr: number }
  sentAt: { _seconds: number } | null
  createdAt: { _seconds: number } | null
}

const fmtZar = new Intl.NumberFormat('en-ZA', {
  style: 'currency', currency: 'ZAR', maximumFractionDigits: 0,
})

function fmtTs(ts: { _seconds: number } | null) {
  if (!ts) return '—'
  return new Date(ts._seconds * 1000).toLocaleDateString('en-ZA', { dateStyle: 'medium' })
}

const STATUS_PILL: Record<string, string> = {
  sent: 'pib-pill pib-pill-success',
  draft: 'pib-pill',
  scheduled: 'pib-pill pib-pill-info',
  failed: 'pib-pill pib-pill-danger',
}

export default function PortalReports() {
  const [reports, setReports] = useState<PortalReport[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/v1/portal/reports')
      .then((r) => r.json())
      .then((b) => { setReports(b.reports ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-10">
      <header>
        <p className="eyebrow">Performance reports</p>
        <h1 className="pib-page-title mt-2">Reports</h1>
        <p className="pib-page-sub max-w-2xl">
          Branded monthly performance reports — generated on the 1st of each month and shareable with your stakeholders.
        </p>
      </header>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="pib-skeleton h-24" />
          ))}
        </div>
      ) : reports.length === 0 ? (
        <div className="bento-card p-10 text-center">
          <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)]">analytics</span>
          <h2 className="font-display text-2xl mt-4">No reports yet.</h2>
          <p className="text-sm text-[var(--color-pib-text-muted)] max-w-md mx-auto mt-2">
            The first monthly report will appear after the first full month of connected data.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {reports.map((r) => (
            <article key={r.id} className="bento-card flex items-center justify-between gap-6 flex-wrap">
              <div className="space-y-2 min-w-0">
                <p className="font-display text-2xl leading-tight">
                  {r.period.start} → {r.period.end}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="pill">{r.type}</span>
                  <span className={STATUS_PILL[r.status] ?? 'pib-pill'}>{r.status}</span>
                  <span className="text-xs text-[var(--color-pib-text-muted)] font-mono">
                    sent {fmtTs(r.sentAt)}
                  </span>
                </div>
                <p className="text-xs text-[var(--color-pib-text-muted)] font-mono">
                  Total revenue {fmtZar.format(r.kpis.total_revenue)} · MRR {fmtZar.format(r.kpis.mrr)}
                </p>
              </div>
              {r.publicToken ? (
                <Link
                  href={`/reports/${r.publicToken}`}
                  target="_blank"
                  className="btn-pib-accent !py-2 !px-4 !text-sm"
                >
                  Open report
                  <span className="material-symbols-outlined text-base">arrow_outward</span>
                </Link>
              ) : (
                <span className="pib-pill">draft</span>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
