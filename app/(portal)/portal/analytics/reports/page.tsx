'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnalyticsNav } from '@/components/admin/AnalyticsNav'
import { AnalyticsPropertyPicker } from '@/components/admin/AnalyticsPropertyPicker'
import { SimpleTable } from '@/components/analytics/Primitives'
import { Icon } from '@/components/studio'
import { PageHeader, EmptyState } from '@/components/ui/AppFoundation'

interface Report {
  id: string
  name: string
  frequency: 'weekly' | 'monthly'
  metrics: string[]
  recipients: string[]
  active: boolean
  lastRunAt: string | null
}

interface RunResult {
  runId: string
  status: string
  metrics?: unknown
  error?: string
}

interface HistoryEntry {
  id: string
  ranAt: string
  rangeFrom: string
  rangeTo: string
  status: string
  recipients: string[]
  metrics: string[]
}

const METRIC_OPTIONS = [
  'sessions', 'uniqueVisitors', 'pageviews', 'bounceRate',
  'avgDurationSec', 'topSources', 'topPages',
]

export default function ReportsPage() {
  const sp = useSearchParams()
  const initialPid = sp?.get('propertyId') ?? ''
  const [propertyId, setPropertyId] = useState(initialPid)
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  // create form
  const [newName, setNewName] = useState('')
  const [newFrequency, setNewFrequency] = useState<'weekly' | 'monthly'>('weekly')
  const [newMetrics, setNewMetrics] = useState<string[]>(['sessions', 'uniqueVisitors', 'pageviews'])
  const [newRecipients, setNewRecipients] = useState('')

  // per-report state
  const [expanded, setExpanded] = useState<string | null>(null)
  const [history, setHistory] = useState<Record<string, HistoryEntry[]>>({})
  const [historyLoading, setHistoryLoading] = useState<string | null>(null)
  const [runResult, setRunResult] = useState<Record<string, RunResult>>({})
  const [running, setRunning] = useState<string | null>(null)

  async function fetchReports() {
    if (!propertyId.trim()) return
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/analytics/reports?propertyId=${encodeURIComponent(propertyId)}`)
      if (!res.ok) throw new Error('Failed')
      const body = await res.json()
      setReports(body.data ?? body)
    } catch {
      setReports([])
    } finally {
      setLoading(false)
    }
  }

  function toggleMetric(m: string) {
    setNewMetrics(ms => ms.includes(m) ? ms.filter(x => x !== m) : [...ms, m])
  }

  async function createReport() {
    if (!newName.trim()) { setError('Name is required'); return }
    if (newMetrics.length === 0) { setError('Select at least one metric'); return }
    const recipients = newRecipients.split(',').map(r => r.trim()).filter(Boolean)
    if (recipients.length === 0) { setError('At least one recipient email required'); return }
    setError('')
    setCreating(true)
    try {
      const res = await fetch('/api/v1/analytics/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ propertyId, name: newName.trim(), frequency: newFrequency, metrics: newMetrics, recipients }),
      })
      if (!res.ok) {
        const b = await res.json()
        throw new Error(b.error ?? 'Failed')
      }
      setNewName(''); setNewRecipients('')
      setNewMetrics(['sessions', 'uniqueVisitors', 'pageviews'])
      setNewFrequency('weekly')
      await fetchReports()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create report')
    } finally {
      setCreating(false)
    }
  }

  async function toggleActive(report: Report) {
    const res = await fetch(`/api/v1/analytics/reports/${report.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ active: !report.active }),
    })
    if (res.ok) {
      setReports(rs => rs.map(r => r.id === report.id ? { ...r, active: !r.active } : r))
    }
  }

  async function deleteReport(id: string) {
    if (!confirm('Delete this report?')) return
    await fetch(`/api/v1/analytics/reports/${id}`, { method: 'DELETE' })
    setReports(rs => rs.filter(r => r.id !== id))
    if (expanded === id) setExpanded(null)
  }

  async function runNow(id: string) {
    setRunning(id)
    try {
      const res = await fetch(`/api/v1/analytics/reports/${id}/run`, { method: 'POST' })
      const body = await res.json()
      setRunResult(rr => ({ ...rr, [id]: body.data ?? body }))
      if (expanded === id) loadHistory(id)
    } catch {
      setRunResult(rr => ({ ...rr, [id]: { runId: '', status: 'error', error: 'Run failed' } }))
    } finally {
      setRunning(null)
    }
  }

  async function loadHistory(id: string) {
    setHistoryLoading(id)
    try {
      const res = await fetch(`/api/v1/analytics/reports/${id}/history`)
      if (!res.ok) throw new Error('Failed')
      const body = await res.json()
      setHistory(h => ({ ...h, [id]: body.data ?? body }))
    } catch {
      setHistory(h => ({ ...h, [id]: [] }))
    } finally {
      setHistoryLoading(null)
    }
  }

  function toggleExpand(id: string) {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    if (!history[id]) loadHistory(id)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6" data-module-accent="violet">
      <AnalyticsNav active="reports" propertyId={propertyId} />
      <PageHeader
        eyebrow="Analytics · Reports"
        title="Scheduled Reports."
      />

      <div className="st-panel space-y-4">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} />
        <div className="flex justify-end">
          <button name="page-action-21" onClick={fetchReports} disabled={!propertyId || loading} className="st-btn st-btn--primary text-sm">
            {loading ? 'Loading…' : 'Load Reports'}
          </button>
        </div>
      </div>

      {/* Create report form */}
      {propertyId && (
        <div className="st-panel space-y-4">
          <div className="flex items-center gap-3">
            <Icon name="lab_profile" />
            <h2 className="pib-label mb-0">Create Report</h2>
          </div>
          <div>
            <label className="pib-label mb-1">Name</label>
            <input name="text" type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Weekly Summary" className="pib-input text-sm w-72" />
          </div>
          <div>
            <label className="pib-label mb-1">Frequency</label>
            <select name="page-select-22" value={newFrequency} onChange={e => setNewFrequency(e.target.value as 'weekly' | 'monthly')} className="pib-select text-sm w-40">
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div>
            <label className="pib-label mb-2">Metrics</label>
            <div className="flex flex-wrap gap-3">
              {METRIC_OPTIONS.map(m => (
                <label key={m} className="flex items-center gap-1.5 text-sm text-[var(--color-pib-text)] cursor-pointer">
                  <input name="page-field-23" type="checkbox" checked={newMetrics.includes(m)} onChange={() => toggleMetric(m)} />
                  {m}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="pib-label mb-1">Recipients (comma-separated emails)</label>
            <input name="text" type="text" value={newRecipients} onChange={e => setNewRecipients(e.target.value)} placeholder="a@x.com, b@y.com" className="pib-input text-sm w-96 max-w-full" />
          </div>
          {error && <p className="text-xs text-[var(--color-error)]">{error}</p>}
          <button name="page-action-24" onClick={createReport} disabled={creating || !newName.trim()} className="st-btn st-btn--primary text-sm">
            {creating ? 'Creating…' : 'Create Report'}
          </button>
        </div>
      )}

      {/* Reports list */}
      {reports.length > 0 && (
        <div className="space-y-4">
          {reports.map(r => (
            <div key={r.id} className="st-panel space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <Icon name="lab_profile" />
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium text-[var(--color-pib-text)] flex items-center gap-2">
                      {r.name}
                      <span className={`pib-pill ${r.active ? 'pib-pill-success' : ''}`}>
                        {r.active ? 'Active' : 'Paused'}
                      </span>
                    </h3>
                    <p className="text-xs text-[var(--color-pib-text-muted)] mt-0.5">
                      {r.frequency} · {r.metrics.join(', ')} · {r.recipients.join(', ')}
                    </p>
                    {r.lastRunAt && <p className="text-xs text-[var(--color-pib-text-muted)]">Last run: {new Date(r.lastRunAt).toLocaleString()}</p>}
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap justify-end">
                  <button name="page-action-25" onClick={() => runNow(r.id)} disabled={running === r.id} className="st-btn st-btn--secondary text-xs px-3 py-1.5">
                    {running === r.id ? 'Running…' : 'Run now'}
                  </button>
                  <a href={`/api/v1/analytics/reports/${r.id}/pdf`} download className="st-btn st-btn--secondary text-xs px-3 py-1.5">
                    PDF
                  </a>
                  <button name="page-action-26" onClick={() => toggleActive(r)} className="st-btn st-btn--secondary text-xs px-3 py-1.5">
                    {r.active ? 'Pause' : 'Activate'}
                  </button>
                  <button name="page-action-27" onClick={() => toggleExpand(r.id)} className="st-btn st-btn--secondary text-xs px-3 py-1.5">
                    {expanded === r.id ? 'Hide history' : 'History'}
                  </button>
                  <button name="page-action-28" onClick={() => deleteReport(r.id)} className="st-btn st-btn--ghost text-xs px-3 py-1.5 text-[var(--color-error)]">
                    Delete
                  </button>
                </div>
              </div>

              {runResult[r.id] && (
                <p className={`text-xs ${runResult[r.id].status === 'error' ? 'text-[var(--color-error)]' : 'text-[var(--color-pib-success)]'}`}>
                  Run {runResult[r.id].status}{runResult[r.id].error ? `: ${runResult[r.id].error}` : ''}
                </p>
              )}

              {expanded === r.id && (
                <div className="border-t border-[var(--color-pib-line)] pt-3">
                  {historyLoading === r.id && <div className="pib-skeleton h-12" />}
                  {historyLoading !== r.id && (
                    <SimpleTable
                      columns={[
                        { key: 'ranAt', label: 'Ran at' },
                        { key: 'range', label: 'Range' },
                        { key: 'status', label: 'Status' },
                        { key: 'recipients', label: 'Recipients', align: 'right' },
                      ]}
                      rows={(history[r.id] ?? []).map(h => ({
                        ranAt: new Date(h.ranAt).toLocaleString(),
                        range: `${h.rangeFrom} → ${h.rangeTo}`,
                        status: h.status,
                        recipients: h.recipients?.join(', ') ?? ' - ',
                      }))}
                      empty="No runs yet."
                    />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && reports.length === 0 && propertyId && (
        <EmptyState title="No reports yet  -  create one above." />
      )}
    </div>
  )
}
