'use client'

import { useEffect, useState } from 'react'
import { Surface, StatusPill, EmptyState } from '@/components/ui/AppFoundation'
import { apiGet, apiSend, formatDateTime } from './OrgDetailApi'

type ExportType = 'contacts' | 'emails' | 'social' | 'activity'

interface ExportJob {
  id: string
  type: string
  range: { from: string | null; to: string | null } | null
  rowCount: number
  filename: string | null
  status: string
  createdAt: string | null
}

const TYPE_LABELS: Record<ExportType, string> = {
  contacts: 'Contacts',
  emails: 'Emails',
  social: 'Social posts',
  activity: 'Activity log',
}

export function OrgAnalyticsExportPanel({ slug }: { slug: string }) {
  const [type, setType] = useState<ExportType>('contacts')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [lastResult, setLastResult] = useState<{ rowCount: number; filename: string } | null>(null)
  const [jobs, setJobs] = useState<ExportJob[]>([])

  function loadJobs() {
    apiGet<{ jobs: ExportJob[] }>(`/api/v1/admin/org/${slug}/analytics-export`)
      .then((d) => setJobs(d.jobs || []))
      .catch(() => { /* non-fatal */ })
  }

  useEffect(() => { loadJobs() }, [slug]) // eslint-disable-line react-hooks/exhaustive-deps

  async function runExport() {
    setRunning(true)
    setError('')
    setLastResult(null)
    try {
      const res = await apiSend<{ csv: string; rowCount: number; filename: string }>(
        `/api/v1/admin/org/${slug}/analytics-export`, 'POST',
        { type, dateFrom: dateFrom || null, dateTo: dateTo || null },
      )
      // Trigger a client-side download.
      const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setLastResult({ rowCount: res.rowCount, filename: res.filename })
      loadJobs()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-6">
      <Surface header={<span className="font-label">New export</span>}>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-on-surface-variant">Type</span>
            <select className="pib-select" value={type} onChange={(e) => setType(e.target.value as ExportType)}>
              {(Object.keys(TYPE_LABELS) as ExportType[]).map((t) => (
                <option key={t} value={t}>{TYPE_LABELS[t]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-on-surface-variant">From (optional)</span>
            <input type="date" className="pib-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-on-surface-variant">To (optional)</span>
            <input type="date" className="pib-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button type="button" className="pib-btn-primary" disabled={running} onClick={runExport}>
            {running ? 'Exporting…' : 'Run export & download CSV'}
          </button>
          {lastResult && (
            <span className="text-xs text-green-400">
              Exported {lastResult.rowCount} row{lastResult.rowCount === 1 ? '' : 's'} → {lastResult.filename}
            </span>
          )}
        </div>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </Surface>

      <Surface header={<span className="font-label">Recent exports</span>}>
        {jobs.length === 0 ? (
          <EmptyState icon="download" title="No exports yet" description="Run an export above to create the first job." />
        ) : (
          <div className="divide-y divide-white/5">
            {jobs.map((j) => (
              <div key={j.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-on-surface">{TYPE_LABELS[j.type as ExportType] ?? j.type}</p>
                  <p className="text-xs text-on-surface-variant">
                    {j.rowCount} rows · {formatDateTime(j.createdAt)}
                    {j.range?.from || j.range?.to ? ` · ${j.range?.from ?? '…'} → ${j.range?.to ?? '…'}` : ''}
                  </p>
                </div>
                <StatusPill tone={j.status === 'complete' ? 'success' : 'neutral'}>{j.status}</StatusPill>
              </div>
            ))}
          </div>
        )}
      </Surface>
    </div>
  )
}
