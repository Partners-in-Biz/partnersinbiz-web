'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnalyticsNav } from '@/components/admin/AnalyticsNav'
import { AnalyticsPropertyPicker } from '@/components/admin/AnalyticsPropertyPicker'
import { SimpleTable } from '@/components/analytics/Primitives'

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
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <AnalyticsNav active="reports" propertyId={propertyId} />
      <h1 className="text-xl font-headline font-bold text-on-surface">Scheduled Reports</h1>

      <div className="pib-card p-4 space-y-3">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} />
        <div className="flex justify-end">
          <button onClick={fetchReports} disabled={!propertyId || loading} className="pib-btn-primary text-sm font-label">
            {loading ? 'Loading…' : 'Load Reports'}
          </button>
        </div>
      </div>

      {/* Create report form */}
      {propertyId && (
        <div className="pib-card p-4 space-y-4">
          <h2 className="text-sm font-label font-semibold text-on-surface">Create Report</h2>
          <div>
            <label className="text-xs text-on-surface-variant font-label block mb-1">Name</label>
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Weekly Summary" className="pib-input text-sm w-72" />
          </div>
          <div>
            <label className="text-xs text-on-surface-variant font-label block mb-1">Frequency</label>
            <select value={newFrequency} onChange={e => setNewFrequency(e.target.value as 'weekly' | 'monthly')} className="pib-input text-sm w-40">
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-on-surface-variant font-label block mb-2">Metrics</label>
            <div className="flex flex-wrap gap-3">
              {METRIC_OPTIONS.map(m => (
                <label key={m} className="flex items-center gap-1.5 text-sm text-on-surface cursor-pointer">
                  <input type="checkbox" checked={newMetrics.includes(m)} onChange={() => toggleMetric(m)} />
                  {m}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-on-surface-variant font-label block mb-1">Recipients (comma-separated emails)</label>
            <input type="text" value={newRecipients} onChange={e => setNewRecipients(e.target.value)} placeholder="a@x.com, b@y.com" className="pib-input text-sm w-96 max-w-full" />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button onClick={createReport} disabled={creating || !newName.trim()} className="pib-btn-primary text-sm font-label">
            {creating ? 'Creating…' : 'Create Report'}
          </button>
        </div>
      )}

      {/* Reports list */}
      {reports.length > 0 && (
        <div className="space-y-4">
          {reports.map(r => (
            <div key={r.id} className="pib-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-sm font-label font-semibold text-on-surface flex items-center gap-2">
                    {r.name}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${r.active ? 'bg-green-400/20 text-green-400' : 'bg-[var(--color-surface-container)] text-on-surface-variant'}`}>
                      {r.active ? 'Active' : 'Paused'}
                    </span>
                  </h3>
                  <p className="text-xs text-on-surface-variant mt-0.5">
                    {r.frequency} · {r.metrics.join(', ')} · {r.recipients.join(', ')}
                  </p>
                  {r.lastRunAt && <p className="text-xs text-on-surface-variant">Last run: {new Date(r.lastRunAt).toLocaleString()}</p>}
                </div>
                <div className="flex gap-2 flex-wrap justify-end">
                  <button onClick={() => runNow(r.id)} disabled={running === r.id} className="pib-btn-secondary text-xs px-3 py-1.5">
                    {running === r.id ? 'Running…' : 'Run now'}
                  </button>
                  <a href={`/api/v1/analytics/reports/${r.id}/pdf`} download className="pib-btn-secondary text-xs px-3 py-1.5">
                    PDF
                  </a>
                  <button onClick={() => toggleActive(r)} className="pib-btn-secondary text-xs px-3 py-1.5">
                    {r.active ? 'Pause' : 'Activate'}
                  </button>
                  <button onClick={() => toggleExpand(r.id)} className="pib-btn-secondary text-xs px-3 py-1.5">
                    {expanded === r.id ? 'Hide history' : 'History'}
                  </button>
                  <button onClick={() => deleteReport(r.id)} className="pib-btn-secondary text-xs px-3 py-1.5 text-red-400">
                    Delete
                  </button>
                </div>
              </div>

              {runResult[r.id] && (
                <p className={`text-xs ${runResult[r.id].status === 'error' ? 'text-red-400' : 'text-green-400'}`}>
                  Run {runResult[r.id].status}{runResult[r.id].error ? `: ${runResult[r.id].error}` : ''}
                </p>
              )}

              {expanded === r.id && (
                <div className="border-t border-[var(--color-card-border)] pt-3">
                  {historyLoading === r.id && <div className="pib-skeleton h-12 rounded-lg" />}
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
                        recipients: h.recipients?.join(', ') ?? '—',
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
        <div className="pib-card p-8 text-center text-on-surface-variant text-sm">
          No reports yet — create one above.
        </div>
      )}
    </div>
  )
}
