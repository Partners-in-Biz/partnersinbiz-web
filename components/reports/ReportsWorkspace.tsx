'use client'

import Link from 'next/link'

export interface ReportsWorkspaceReport {
  id: string
  type: string
  period: { start: string; end: string; tz?: string }
  status: string
  publicToken: string | null
  brand?: { orgName?: string }
  kpis: { total_revenue: number; mrr: number }
  createdAt: { _seconds: number } | null
  sentAt: { _seconds: number } | null
}

interface ReportsWorkspaceProps {
  reports: ReportsWorkspaceReport[]
  loading: boolean
  mode: 'admin' | 'portal'
  defaultOrgName?: string
  emptyMessage: string
  busyReportId?: string | null
  onSendReport?: (id: string) => void
}

const fmtZar = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  maximumFractionDigits: 0,
})

const STATUS_PILL: Record<string, string> = {
  archived: 'pib-pill',
  draft: 'pib-pill',
  failed: 'pib-pill pib-pill-danger',
  rendered: 'pib-pill pib-pill-info',
  scheduled: 'pib-pill pib-pill-info',
  sent: 'pib-pill pib-pill-success',
}

function money(value: number) {
  return fmtZar.format(value).replace(/\u00a0/g, ' ')
}

function fmtTs(ts: { _seconds: number } | null) {
  if (!ts) return '-'
  return new Date(ts._seconds * 1000).toLocaleString('en-ZA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function reportTitle(report: ReportsWorkspaceReport, defaultOrgName = '') {
  const orgName = report.brand?.orgName || defaultOrgName
  const period = `${report.period.start} -> ${report.period.end}`
  return orgName ? `${orgName} - ${period}` : period
}

export function ReportsWorkspace({
  reports,
  loading,
  mode,
  defaultOrgName,
  emptyMessage,
  busyReportId,
  onSendReport,
}: ReportsWorkspaceProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="pib-skeleton h-24" />
        ))}
      </div>
    )
  }

  if (reports.length === 0) {
    return (
      <div className="bento-card p-10 text-center">
        <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)]">analytics</span>
        <h2 className="font-display text-2xl mt-4">No reports yet.</h2>
        <p className="text-sm text-[var(--color-pib-text-muted)] max-w-md mx-auto mt-2">
          {emptyMessage}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {reports.map((report) => {
        const title = reportTitle(report, defaultOrgName)
        const actionLabel = report.status === 'sent' ? 'Resend report' : 'Send report'
        return (
          <article key={report.id} className="pib-card flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <h3 className="text-base font-medium text-[var(--color-pib-text)]">
                  {title}
                </h3>
                <span className={STATUS_PILL[report.status] ?? 'pib-pill'}>{report.status}</span>
                <span className="text-[10px] uppercase tracking-wider text-[var(--color-pib-text-muted)] font-mono">
                  {report.type}
                </span>
              </div>
              <p className="text-xs text-[var(--color-pib-text-muted)] font-mono">
                Total revenue {money(report.kpis.total_revenue)} · MRR {money(report.kpis.mrr)}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-pib-text-muted)] font-mono">
                <span>Created {fmtTs(report.createdAt)}</span>
                {report.sentAt ? <span>Sent {fmtTs(report.sentAt)}</span> : null}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {report.publicToken ? (
                <Link
                  href={`/reports/${report.publicToken}`}
                  target="_blank"
                  className={mode === 'admin' ? 'btn-pib-secondary !py-2 !px-4 !text-sm' : 'btn-pib-accent !py-2 !px-4 !text-sm'}
                >
                  {mode === 'admin' ? 'Preview report' : 'Open report'}
                  <span className="material-symbols-outlined text-base">arrow_outward</span>
                </Link>
              ) : (
                <span className="pib-pill">draft</span>
              )}

              {mode === 'admin' && onSendReport ? (
                <button
                  type="button"
                  disabled={busyReportId === report.id || !report.publicToken}
                  onClick={() => onSendReport(report.id)}
                  aria-label={`${actionLabel} ${title}`}
                  className="btn-pib-accent !py-2 !px-4 !text-sm disabled:opacity-60"
                >
                  {busyReportId === report.id ? 'Sending...' : actionLabel}
                </button>
              ) : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}
