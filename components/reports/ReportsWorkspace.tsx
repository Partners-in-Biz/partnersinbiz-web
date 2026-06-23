'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ReportShareDialog } from './ReportShareDialog'
import { ReportScheduleDialog } from './ReportScheduleDialog'
import {
  REPORT_CATEGORIES,
  REPORT_CATEGORY_LABELS,
  type ReportCategory,
} from '@/lib/reports/types'

export interface ReportsWorkspaceReport {
  id: string
  type: string
  category?: ReportCategory
  period: { start: string; end: string; tz?: string }
  status: string
  publicToken: string | null
  share?: { enabled: boolean; expiresAt: string | null }
  scheduleId?: string | null
  openCount?: number
  uniqueOpenCount?: number
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
  /** When provided, admin management controls render. */
  orgId?: string | null
  /** Base path for the custom builder + scheduling, with scope query already applied. */
  newReportHref?: string
  /** Called after a mutation (delete/share/schedule) so the parent can refresh. */
  onMutated?: () => void
  /** Called when "Generate new report" KPI shortcut is pressed. */
  onGenerate?: () => void
  generating?: boolean
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
  return fmtZar.format(value).replace(/ /g, ' ')
}

function fmtTs(ts: { _seconds: number } | null) {
  if (!ts) return '-'
  return new Date(ts._seconds * 1000).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })
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
  orgId,
  newReportHref,
  onMutated,
  onGenerate,
  generating,
}: ReportsWorkspaceProps) {
  const [filter, setFilter] = useState<'all' | ReportCategory>('all')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [shareReport, setShareReport] = useState<ReportsWorkspaceReport | null>(null)
  const [scheduleReport, setScheduleReport] = useState<ReportsWorkspaceReport | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const isAdmin = mode === 'admin'

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: reports.length }
    for (const cat of REPORT_CATEGORIES) c[cat] = 0
    for (const r of reports) {
      const cat = r.category ?? 'monthly'
      c[cat] = (c[cat] ?? 0) + 1
    }
    return c
  }, [reports])

  const visible = useMemo(
    () => (filter === 'all' ? reports : reports.filter((r) => (r.category ?? 'monthly') === filter)),
    [reports, filter],
  )

  function scopedApi(path: string) {
    return orgId ? `${path}${path.includes('?') ? '&' : '?'}orgId=${encodeURIComponent(orgId)}` : path
  }

  async function downloadPdf(report: ReportsWorkspaceReport) {
    setBusyId(report.id)
    try {
      const res = await fetch(scopedApi(`/api/v1/reports/${report.id}/pdf`))
      if (!res.ok) throw new Error('PDF failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${reportTitle(report, defaultOrgName).replace(/[^a-z0-9]+/gi, '_')}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      alert('Could not generate the PDF. Try again.')
    } finally {
      setBusyId(null)
    }
  }

  async function deleteReport(report: ReportsWorkspaceReport) {
    setBusyId(report.id)
    try {
      const res = await fetch(scopedApi(`/api/v1/reports/${report.id}`), { method: 'DELETE' })
      if (!res.ok) throw new Error('delete failed')
      setConfirmDelete(null)
      onMutated?.()
    } catch {
      alert('Could not delete the report.')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="pib-skeleton h-24" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Toolbar: filter + generate */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter reports by type">
          <FilterChip active={filter === 'all'} label="All" count={counts.all} onClick={() => setFilter('all')} />
          {REPORT_CATEGORIES.map((cat) => (
            <FilterChip
              key={cat}
              active={filter === cat}
              label={REPORT_CATEGORY_LABELS[cat]}
              count={counts[cat] ?? 0}
              onClick={() => setFilter(cat)}
            />
          ))}
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2">
            {onGenerate && (
              <button
                type="button"
                onClick={onGenerate}
                disabled={generating}
                className="btn-pib-secondary !py-2 !px-4 !text-sm disabled:opacity-60"
              >
                {generating ? 'Generating...' : 'Generate monthly'}
              </button>
            )}
            {newReportHref && (
              <Link href={newReportHref} className="btn-pib-accent !py-2 !px-4 !text-sm">
                <span className="material-symbols-outlined text-base">add</span>
                Generate new report
              </Link>
            )}
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="bento-card p-10 text-center">
          <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)]">analytics</span>
          <h2 className="font-display text-2xl mt-4">No reports yet.</h2>
          <p className="text-sm text-[var(--color-pib-text-muted)] max-w-md mx-auto mt-2">{emptyMessage}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((report) => {
            const title = reportTitle(report, defaultOrgName)
            const actionLabel = report.status === 'sent' ? 'Resend report' : 'Send report'
            const category = report.category ?? 'monthly'
            const linkLive = report.publicToken && report.share?.enabled !== false
            return (
              <article key={report.id} className="pib-card flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-medium text-[var(--color-pib-text)]">{title}</h3>
                    <span className={STATUS_PILL[report.status] ?? 'pib-pill'}>{report.status}</span>
                    <span className="pib-pill !text-[10px] uppercase tracking-wider">
                      {REPORT_CATEGORY_LABELS[category]}
                    </span>
                    {report.scheduleId ? (
                      <span
                        className="pib-pill pib-pill-info inline-flex items-center gap-1"
                        title="This report is on a schedule"
                      >
                        <span className="material-symbols-outlined text-[13px] leading-none">schedule</span>
                        scheduled
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-[var(--color-pib-text-muted)] font-mono">
                    Total revenue {money(report.kpis.total_revenue)} · MRR {money(report.kpis.mrr)}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-pib-text-muted)] font-mono">
                    <span>Created {fmtTs(report.createdAt)}</span>
                    {report.sentAt ? <span>Sent {fmtTs(report.sentAt)}</span> : null}
                    {typeof report.uniqueOpenCount === 'number' ? (
                      <span>
                        {report.uniqueOpenCount} unique · {report.openCount ?? 0} opens
                      </span>
                    ) : null}
                    {report.publicToken && !linkLive ? <span className="text-rose-300">link disabled</span> : null}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                  {report.publicToken && linkLive ? (
                    <Link
                      href={`/reports/${report.publicToken}`}
                      target="_blank"
                      className={isAdmin ? 'btn-pib-secondary !py-2 !px-4 !text-sm' : 'btn-pib-accent !py-2 !px-4 !text-sm'}
                    >
                      {isAdmin ? 'Preview' : 'Open report'}
                      <span className="material-symbols-outlined text-base">arrow_outward</span>
                    </Link>
                  ) : (
                    <span className="pib-pill">{report.publicToken ? 'link off' : 'draft'}</span>
                  )}

                  {isAdmin && (
                    <>
                      <button
                        type="button"
                        onClick={() => downloadPdf(report)}
                        disabled={busyId === report.id}
                        aria-label={`Download PDF for ${title}`}
                        className="btn-pib-secondary !py-2 !px-3 !text-sm disabled:opacity-60"
                        title="Download PDF"
                      >
                        <span className="material-symbols-outlined text-base">picture_as_pdf</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setShareReport(report)}
                        aria-label={`Share settings for ${title}`}
                        className="btn-pib-secondary !py-2 !px-3 !text-sm"
                        title="Share settings"
                      >
                        <span className="material-symbols-outlined text-base">share</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setScheduleReport(report)}
                        aria-label={`Schedule ${title}`}
                        className="btn-pib-secondary !py-2 !px-3 !text-sm"
                        title="Schedule"
                      >
                        <span className="material-symbols-outlined text-base">schedule_send</span>
                      </button>

                      {onSendReport ? (
                        <button
                          type="button"
                          disabled={busyReportId === report.id || !linkLive}
                          onClick={() => onSendReport(report.id)}
                          aria-label={`${actionLabel} ${title}`}
                          className="btn-pib-accent !py-2 !px-4 !text-sm disabled:opacity-60"
                        >
                          {busyReportId === report.id ? 'Sending...' : actionLabel}
                        </button>
                      ) : null}

                      {confirmDelete === report.id ? (
                        <span className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => deleteReport(report)}
                            disabled={busyId === report.id}
                            className="btn-pib-secondary !py-2 !px-3 !text-sm !text-rose-300 !border-rose-400/40"
                          >
                            {busyId === report.id ? 'Deleting...' : 'Confirm'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(null)}
                            className="btn-pib-secondary !py-2 !px-3 !text-sm"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(report.id)}
                          aria-label={`Delete ${title}`}
                          className="btn-pib-secondary !py-2 !px-3 !text-sm"
                          title="Delete"
                        >
                          <span className="material-symbols-outlined text-base">delete</span>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {shareReport && (
        <ReportShareDialog
          report={shareReport}
          orgId={orgId ?? null}
          onClose={() => setShareReport(null)}
          onMutated={onMutated}
        />
      )}
      {scheduleReport && (
        <ReportScheduleDialog
          report={scheduleReport}
          orgId={orgId ?? null}
          onClose={() => setScheduleReport(null)}
          onMutated={onMutated}
        />
      )}
    </div>
  )
}

function FilterChip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean
  label: string
  count: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`pib-pill !text-xs ${active ? 'pib-pill-info !border-[var(--color-pib-accent)] !text-[var(--color-pib-accent)]' : ''}`}
    >
      {label}
      <span className="opacity-60 ml-1">{count}</span>
    </button>
  )
}
