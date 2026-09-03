'use client'

import { useCallback, useEffect, useState } from 'react'
import { EmptyState, PageHeader } from '@/components/ui/AppFoundation'
import {
  Button,
  Checkbox,
  Field,
  Icon,
  Input,
  Notice,
  Panel,
  Skeleton,
  Status,
  Title,
  Toolbar,
} from '@/components/studio'

type ServiceStatus = 'ok' | 'degraded' | 'down' | 'not-configured'

interface ServiceHealth {
  name: string
  key: string
  status: ServiceStatus
  latencyMs: number | null
  latencyInstrumented: boolean
  lastCheckedAt: string
  detail: string | null
}

interface UptimeRow {
  service: string
  serviceName: string
  totalChecks: number
  okChecks: number
  uptimePct: number | null
  avgLatencyMs: number | null
}

interface Incident {
  service: string
  serviceName: string
  startedAt: string
  endedAt: string | null
  worstStatus: 'degraded' | 'down'
  checks: number
}

interface ServiceAlert {
  enabled: boolean
  latencyThresholdMs: number
}

const STATUS_TONE: Record<ServiceStatus, 'success' | 'warning' | 'danger' | 'info'> = {
  ok: 'success',
  degraded: 'warning',
  down: 'danger',
  'not-configured': 'info',
}

const STATUS_LABEL: Record<ServiceStatus, string> = {
  ok: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
  'not-configured': 'Not configured',
}

function fmtLatency(ms: number | null, instrumented: boolean): string {
  if (!instrumented) return 'not instrumented'
  if (ms === null) return '-'
  return `${ms} ms`
}

function timeAgo(iso: string): string {
  const d = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(d)) return '-'
  const s = Math.floor(d / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

export default function HealthClient() {
  const [services, setServices] = useState<ServiceHealth[]>([])
  const [overall, setOverall] = useState<ServiceStatus>('ok')
  const [uptime, setUptime] = useState<UptimeRow[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [uptimeNote, setUptimeNote] = useState('')
  const [alerts, setAlerts] = useState<Record<string, ServiceAlert>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [savingAlerts, setSavingAlerts] = useState(false)
  const [alertsMsg, setAlertsMsg] = useState<string | null>(null)

  const loadHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/admin/system/health')
      const body = await res.json()
      const data = body.data ?? body
      if (!res.ok) {
        setError(body?.error ?? 'Failed to load health')
        return
      }
      setServices(data.services ?? [])
      setOverall(data.overall ?? 'ok')
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load health')
    }
  }, [])

  const loadUptime = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/admin/system/health/uptime')
      const body = await res.json()
      const data = body.data ?? body
      if (res.ok) {
        setUptime(data.uptime ?? [])
        setIncidents(data.incidents ?? [])
        setUptimeNote(data.note ?? '')
      }
    } catch {
      /* uptime is supplementary */
    }
  }, [])

  const loadAlerts = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/admin/system/health/alerts')
      const body = await res.json()
      const data = body.data ?? body
      if (res.ok) setAlerts(data.services ?? {})
    } catch {
      /* ignore */
    }
  }, [])

  const refresh = useCallback(async () => {
    await Promise.all([loadHealth(), loadUptime()])
    setLoading(false)
  }, [loadHealth, loadUptime])

  useEffect(() => {
    refresh()
    loadAlerts()
    fetch('/api/auth/verify')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setIsSuperAdmin(Boolean(s?.isSuperAdmin)))
      .catch(() => setIsSuperAdmin(false))
    const id = setInterval(refresh, 30_000)
    return () => clearInterval(id)
  }, [refresh, loadAlerts])

  async function saveAlerts(e: React.FormEvent) {
    e.preventDefault()
    setSavingAlerts(true)
    setAlertsMsg(null)
    try {
      const res = await fetch('/api/v1/admin/system/health/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ services: alerts }),
      })
      const body = await res.json()
      if (!res.ok) {
        setAlertsMsg(body?.error ?? 'Failed to save')
      } else {
        setAlerts((body.data ?? body).services ?? alerts)
        setAlertsMsg('Saved')
      }
    } catch (err) {
      setAlertsMsg(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSavingAlerts(false)
    }
  }

  const uptimeFor = (key: string) => uptime.find((u) => u.service === key)

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        eyebrow="System"
        title="Service health."
        description="Live per-service probes with measured latency, 30-day uptime, and incident history. Auto-refreshes every 30s."
        meta={!loading ? <Status tone={STATUS_TONE[overall]}>{STATUS_LABEL[overall]}</Status> : undefined}
        actions={(
          <Button variant="ghost" size="sm" onClick={refresh} aria-label="Refresh health">
            <Icon name="refresh" />
            Refresh
          </Button>
        )}
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height="8rem" />)
          : services.map((svc) => {
              const up = uptimeFor(svc.key)
              return (
                <Panel key={svc.key} className="space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <Title as="h3" className="!text-base">{svc.name}</Title>
                    <Status tone={STATUS_TONE[svc.status]}>{STATUS_LABEL[svc.status]}</Status>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="sc-tiny">Latency</p>
                      <p className="st-num font-mono text-[var(--sc-ink)]">{fmtLatency(svc.latencyMs, svc.latencyInstrumented)}</p>
                    </div>
                    <div>
                      <p className="sc-tiny">Uptime (30d)</p>
                      <p className="st-num font-mono text-[var(--sc-ink)]">
                        {up && up.uptimePct !== null ? `${up.uptimePct}%` : 'no data'}
                        {up && up.totalChecks > 0 ? (
                          <span className="text-[var(--sc-ink-soft)] text-xs"> ({up.totalChecks} chk)</span>
                        ) : null}
                      </p>
                    </div>
                  </div>
                  {svc.detail ? <p className="sc-body text-[0.875rem]">{svc.detail}</p> : null}
                  <p className="sc-tiny text-[var(--sc-ink-soft)]">Checked {timeAgo(svc.lastCheckedAt)}</p>
                </Panel>
              )
            })}
      </div>

      {!loading ? (
        <Panel className="space-y-4">
          <Title as="h2">Breakdown</Title>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { label: 'Firebase', keys: ['firestore', 'auth'] },
              { label: 'PayPal', keys: ['paypal'] },
              { label: 'Social', keys: ['social'] },
            ].map((group) => (
              <div key={group.label} className="st-panel st-panel--flat p-4 space-y-2">
                <p className="sc-tiny">{group.label}</p>
                {group.keys.map((k) => {
                  const svc = services.find((s) => s.key === k)
                  if (!svc) return null
                  return (
                    <div key={k} className="flex items-center justify-between gap-2 text-sm">
                      <Status tone={STATUS_TONE[svc.status]}>{svc.name}</Status>
                      <span className="st-num font-mono text-xs text-[var(--sc-ink-soft)]">
                        {fmtLatency(svc.latencyMs, svc.latencyInstrumented)}
                      </span>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel className="space-y-4">
        <div>
          <Title as="h2">Incidents (30d)</Title>
          {uptimeNote ? <p className="sc-body text-[0.875rem] mt-1">{uptimeNote}</p> : null}
        </div>
        {incidents.length === 0 ? (
          <EmptyState title="No degraded or down periods in the last 30 days." />
        ) : (
          <div className="space-y-2">
            {incidents.map((inc, i) => (
              <div key={i} className="flex flex-wrap items-center justify-between gap-3 st-panel st-panel--flat p-4 text-sm">
                <div className="flex items-center gap-2">
                  <Status tone={inc.worstStatus === 'down' ? 'danger' : 'warning'}>{inc.worstStatus}</Status>
                  <span className="text-[var(--sc-ink)]">{inc.serviceName}</span>
                </div>
                <div className="sc-tiny text-[var(--sc-ink-soft)]">
                  {new Date(inc.startedAt).toLocaleString()} to {inc.endedAt ? new Date(inc.endedAt).toLocaleString() : 'ongoing'}{' '}
                  ({inc.checks} chk)
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <form onSubmit={saveAlerts}>
        <Panel className="space-y-4">
          <Toolbar>
            <Title as="h2">Alert settings</Title>
            {!isSuperAdmin ? <span className="sc-tiny">Super admin only. View only.</span> : null}
          </Toolbar>
          <div className="space-y-2">
            {Object.entries(alerts).map(([key, cfg]) => {
              const svc = services.find((s) => s.key === key)
              return (
                <div key={key} className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto_auto] items-center st-panel st-panel--flat p-4">
                  <span className="text-sm text-[var(--sc-ink)] capitalize">{svc?.name ?? key}</span>
                  <Field id={`health-threshold-${key}`} label="Threshold (ms)">
                    <Input
                      id={`health-threshold-${key}`}
                      aria-label={`${svc?.name ?? key} latency threshold in milliseconds`}
                      type="number"
                      min={1}
                      className="w-28 font-mono st-num"
                      value={cfg.latencyThresholdMs}
                      disabled={!isSuperAdmin}
                      onChange={(e) =>
                        setAlerts((p) => ({ ...p, [key]: { ...p[key], latencyThresholdMs: Number(e.target.value) } }))
                      }
                    />
                  </Field>
                  <Checkbox
                    id={`health-enabled-${key}`}
                    label="Enabled"
                    checked={cfg.enabled}
                    disabled={!isSuperAdmin}
                    onChange={(e) => setAlerts((p) => ({ ...p, [key]: { ...p[key], enabled: e.target.checked } }))}
                  />
                </div>
              )
            })}
          </div>
          {isSuperAdmin ? (
            <Toolbar>
              <Button type="submit" disabled={savingAlerts}>{savingAlerts ? 'Saving...' : 'Save thresholds'}</Button>
              {alertsMsg ? <span className="sc-tiny">{alertsMsg}</span> : null}
            </Toolbar>
          ) : null}
        </Panel>
      </form>
    </div>
  )
}
