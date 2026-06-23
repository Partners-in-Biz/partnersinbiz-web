'use client'

import { useCallback, useEffect, useState } from 'react'

interface ReportConfig {
  id: string
  name: string
  type: 'gdpr' | 'data_retention' | 'security' | 'access_audit'
  schedule: 'manual' | 'weekly' | 'monthly'
  status: 'scheduled' | 'generated'
  contents: string[]
  lastGeneratedAt?: string | null
  nextRunAt?: string | null
  createdAt?: string
}

interface ReportRun {
  id: string
  reportId: string
  reportName?: string
  reportType?: string
  generatedAt?: string
  summary?: string
  data?: Record<string, unknown>
}

const TYPES = ['gdpr', 'data_retention', 'security', 'access_audit'] as const
const SCHEDULES = ['manual', 'weekly', 'monthly'] as const
const CONTENT_KEYS = [
  { key: 'gdpr_requests', label: 'GDPR requests' },
  { key: 'legal_acceptances', label: 'Legal acceptances' },
  { key: 'admin_users', label: 'Admin users' },
  { key: 'support_tickets', label: 'Open support tickets' },
]

export default function CompliancePage() {
  const [configs, setConfigs] = useState<ReportConfig[]>([])
  const [runs, setRuns] = useState<ReportRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [type, setType] = useState<string>('gdpr')
  const [schedule, setSchedule] = useState<string>('manual')
  const [contents, setContents] = useState<string[]>([])

  const loadConfigs = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/admin/legal/compliance')
      const body = await res.json()
      const data = body.data ?? body
      setConfigs(res.ok ? data.reports ?? [] : [])
    } catch {
      setConfigs([])
    }
  }, [])

  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/admin/legal/compliance/runs')
      const body = await res.json()
      const data = body.data ?? body
      setRuns(res.ok ? data.runs ?? [] : [])
    } catch {
      setRuns([])
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([loadConfigs(), loadRuns()]).finally(() => setLoading(false))
  }, [loadConfigs, loadRuns])

  function toggleContent(key: string) {
    setContents((c) => (c.includes(key) ? c.filter((x) => x !== key) : [...c, key]))
  }

  async function createConfig() {
    if (!name.trim()) { setError('Name is required'); return }
    setBusy(true); setError(null); setFeedback(null)
    try {
      const res = await fetch('/api/v1/admin/legal/compliance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), type, schedule, contents }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Create failed')
      setFeedback('Report config created')
      setName(''); setContents([])
      await loadConfigs()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  async function generate(id: string) {
    setBusy(true); setError(null); setFeedback(null)
    try {
      const res = await fetch(`/api/v1/admin/legal/compliance/${id}/generate`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Generate failed')
      setFeedback('Report generated')
      await Promise.all([loadConfigs(), loadRuns()])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generate failed')
    } finally {
      setBusy(false)
    }
  }

  async function deleteConfig(id: string) {
    if (!confirm('Delete this report config?')) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/v1/admin/legal/compliance/${id}`, { method: 'DELETE' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Delete failed')
      setFeedback('Config deleted')
      await loadConfigs()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">Legal</p>
        <h1 className="text-2xl font-headline font-bold text-on-surface">Automated Compliance Reporting</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Configure scheduled compliance reports and generate snapshots with live platform numbers. Reports store structured data; a PDF renderer can be layered on later.
        </p>
      </div>

      {feedback && <div className="rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs text-green-400">{feedback}</div>}
      {error && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

      {/* Create config */}
      <div className="pib-card space-y-3">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">New report config</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="block md:col-span-1">
            <span className="text-xs text-on-surface-variant">Name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Quarterly GDPR audit"
              className="mt-1 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2 text-sm text-on-surface" />
          </label>
          <label className="block">
            <span className="text-xs text-on-surface-variant">Type</span>
            <select value={type} onChange={(e) => setType(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2 text-sm text-on-surface">
              {TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-on-surface-variant">Schedule</span>
            <select value={schedule} onChange={(e) => setSchedule(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2 text-sm text-on-surface">
              {SCHEDULES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        <div>
          <span className="text-xs text-on-surface-variant">Contents</span>
          <div className="flex flex-wrap gap-2 mt-2">
            {CONTENT_KEYS.map((c) => (
              <button key={c.key} type="button" onClick={() => toggleContent(c.key)}
                className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                  contents.includes(c.key)
                    ? 'border-[var(--color-accent-v2)] text-on-surface bg-[var(--color-surface-container)]'
                    : 'border-[var(--color-card-border)] text-on-surface-variant hover:text-on-surface'
                }`}>
                {contents.includes(c.key) ? '✓ ' : ''}{c.label}
              </button>
            ))}
          </div>
        </div>
        <button type="button" disabled={busy} onClick={createConfig}
          className="text-sm font-medium px-3 py-1.5 rounded-lg text-white disabled:opacity-50" style={{ background: 'var(--color-accent-v2)' }}>
          Create config
        </button>
      </div>

      {/* Config list */}
      <div className="pib-card space-y-2">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-2">Report configs</p>
        {loading ? (
          <p className="text-sm text-on-surface-variant">Loading…</p>
        ) : configs.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No report configs yet.</p>
        ) : (
          configs.map((c) => (
            <div key={c.id} className="flex items-center justify-between p-3 rounded-lg border border-[var(--color-card-border)]">
              <div className="min-w-0">
                <p className="text-sm font-medium text-on-surface truncate">{c.name}</p>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  {c.type.replace('_', ' ')} · {c.schedule}
                  {c.lastGeneratedAt ? ` · last ${String(c.lastGeneratedAt).slice(0, 10)}` : ' · never run'}
                  {c.nextRunAt ? ` · next ${String(c.nextRunAt).slice(0, 10)}` : ''}
                </p>
              </div>
              <div className="flex gap-2 shrink-0 ml-3">
                <button type="button" disabled={busy} onClick={() => generate(c.id)}
                  className="text-xs font-medium px-2.5 py-1 rounded-md text-white disabled:opacity-50" style={{ background: 'var(--color-accent-v2)' }}>
                  Generate now
                </button>
                <button type="button" disabled={busy} onClick={() => deleteConfig(c.id)}
                  className="text-xs font-medium px-2.5 py-1 rounded-md border border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:opacity-50">
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Runs / audit trail */}
      <div className="pib-card space-y-2">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-2">Generated reports</p>
        {runs.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No reports generated yet.</p>
        ) : (
          runs.map((r) => (
            <div key={r.id} className="rounded-lg border border-[var(--color-card-border)]">
              <button type="button" onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                className="w-full text-left p-3 hover:bg-[var(--color-row-hover)] transition-colors rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-on-surface">{r.reportName || r.reportType || 'Report'}</span>
                  <span className="text-[11px] text-on-surface-variant/70">{r.generatedAt ? String(r.generatedAt).slice(0, 19).replace('T', ' ') : ''}</span>
                </div>
                <p className="text-xs text-on-surface-variant mt-1">{r.summary}</p>
              </button>
              {expanded === r.id && r.data && (
                <pre className="text-xs text-on-surface-variant font-mono bg-[var(--color-surface-container)] m-3 mt-0 p-3 rounded-lg overflow-x-auto">
                  {JSON.stringify(r.data, null, 2)}
                </pre>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
