'use client'

import { useCallback, useEffect, useState } from 'react'
import { EmptyState, PageHeader } from '@/components/ui/AppFoundation'
import {
  Button,
  Choice,
  Field,
  Input,
  Notice,
  Panel,
  Select,
  Skeleton,
  Textarea,
  Toolbar,
} from '@/components/studio'

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
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    setBusy(true)
    setError(null)
    setFeedback(null)
    try {
      const res = await fetch('/api/v1/admin/legal/compliance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), type, schedule, contents }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Create failed')
      setFeedback('Report config created')
      setName('')
      setContents([])
      await loadConfigs()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  async function generate(id: string) {
    setBusy(true)
    setError(null)
    setFeedback(null)
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
    setBusy(true)
    setError(null)
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
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        eyebrow="Legal"
        title="Automated compliance reporting."
        description="Configure scheduled compliance reports and generate snapshots with live platform numbers."
      />

      {feedback ? <Notice tone="success">{feedback}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Panel className="space-y-4">
        <p className="sc-tiny">New report config</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field id="compliance-name" label="Name">
            <Input aria-label="Name" id="compliance-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Quarterly GDPR audit"
            />
          </Field>
          <Field id="compliance-type" label="Type">
            <Select aria-label="Type" id="compliance-type" value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace('_', ' ')}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="compliance-schedule" label="Schedule">
            <Select aria-label="Schedule" id="compliance-schedule" value={schedule} onChange={(e) => setSchedule(e.target.value)}>
              {SCHEDULES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="space-y-2">
          <p className="sc-tiny">Contents</p>
          <Toolbar>
            {CONTENT_KEYS.map((c) => (
              <Choice key={c.key} selected={contents.includes(c.key)} onClick={() => toggleContent(c.key)}>
                {contents.includes(c.key) ? `${c.label} selected` : c.label}
              </Choice>
            ))}
          </Toolbar>
        </div>
        <Button type="button" disabled={busy} onClick={createConfig}>
          Create config
        </Button>
      </Panel>

      <Panel className="space-y-4">
        <p className="sc-tiny">Report configs</p>
        {loading ? (
          <Skeleton height="6rem" />
        ) : configs.length === 0 ? (
          <EmptyState title="No report configs yet." description="Create a config to start generating reports." />
        ) : (
          configs.map((c) => (
            <div
              key={c.id}
              className="flex flex-col gap-4 rounded-[6px] border border-[var(--sc-line)] p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="sc-body text-[var(--sc-ink)] truncate">{c.name}</p>
                <p className="sc-tiny mt-1">
                  {c.type.replace('_', ' ')} · {c.schedule}
                  {c.lastGeneratedAt ? ` · last ${String(c.lastGeneratedAt).slice(0, 10)}` : ' · never run'}
                  {c.nextRunAt ? ` · next ${String(c.nextRunAt).slice(0, 10)}` : ''}
                </p>
              </div>
              <Toolbar>
                <Button type="button" size="sm" disabled={busy} onClick={() => generate(c.id)}>
                  Generate now
                </Button>
                <Button type="button" variant="danger" size="sm" disabled={busy} onClick={() => deleteConfig(c.id)}>
                  Delete
                </Button>
              </Toolbar>
            </div>
          ))
        )}
      </Panel>

      <Panel className="space-y-4">
        <p className="sc-tiny">Generated reports</p>
        {runs.length === 0 ? (
          <EmptyState title="No reports generated yet." description="Run a config to produce a snapshot." />
        ) : (
          runs.map((r) => (
            <div key={r.id} className="rounded-[6px] border border-[var(--sc-line)]">
              <button
                type="button"
                onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                className="w-full rounded-[6px] p-4 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--sc-ink)_4%,transparent)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="sc-body text-[var(--sc-ink)]">{r.reportName || r.reportType || 'Report'}</span>
                  <span className="st-num sc-tiny">
                    {r.generatedAt ? String(r.generatedAt).slice(0, 19).replace('T', ' ') : ''}
                  </span>
                </div>
                <p className="sc-tiny mt-1">{r.summary}</p>
              </button>
              {expanded === r.id && r.data ? (
                <Textarea
                  readOnly
                  rows={12}
                  className="m-4 mt-0 font-mono text-xs"
                  value={JSON.stringify(r.data, null, 2)}
                  aria-label="Report data"
                />
              ) : null}
            </div>
          ))
        )}
      </Panel>
    </div>
  )
}
