'use client'

import { useCallback, useEffect, useState } from 'react'

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

const STATUS_META: Record<ServiceStatus, { dot: string; label: string; text: string }> = {
  ok: { dot: 'bg-emerald-500', label: 'Operational', text: 'text-emerald-400' },
  degraded: { dot: 'bg-amber-500', label: 'Degraded', text: 'text-amber-400' },
  down: { dot: 'bg-red-500', label: 'Down', text: 'text-red-400' },
  'not-configured': { dot: 'bg-white/30', label: 'Not configured', text: 'text-on-surface-variant' },
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function fmtLatency(ms: number | null, instrumented: boolean): string {
  if (!instrumented) return 'not instrumented'
  if (ms === null) return '—'
  return `${ms} ms`
}

function timeAgo(iso: string): string {
  const d = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(d)) return '—'
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
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
            System
          </p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Service Health</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Live per-service probes with real measured latency, 30-day uptime, and incident history.
            Auto-refreshes every 30s.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {!loading && (
            <span className={`flex items-center gap-1.5 text-sm font-label ${STATUS_META[overall].text}`}>
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${STATUS_META[overall].dot}`} />
              {STATUS_META[overall].label}
            </span>
          )}
          <button onClick={refresh} className="pib-btn-ghost text-sm font-label flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]">refresh</span>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
      )}

      {/* Service status cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)
          : services.map((svc) => {
              const meta = STATUS_META[svc.status]
              const up = uptimeFor(svc.key)
              return (
                <div key={svc.key} className="pib-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block w-2.5 h-2.5 rounded-full ${meta.dot}`} />
                      <h3 className="font-headline font-semibold text-on-surface">{svc.name}</h3>
                    </div>
                    <span className={`text-xs font-label ${meta.text}`}>{meta.label}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-on-surface-variant">Latency</p>
                      <p className="font-mono text-on-surface">{fmtLatency(svc.latencyMs, svc.latencyInstrumented)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-on-surface-variant">Uptime (30d)</p>
                      <p className="font-mono text-on-surface">
                        {up && up.uptimePct !== null ? `${up.uptimePct}%` : 'no data'}
                        {up && up.totalChecks > 0 && (
                          <span className="text-on-surface-variant text-xs"> ({up.totalChecks} chk)</span>
                        )}
                      </p>
                    </div>
                  </div>
                  {svc.detail && <p className="mt-2 text-xs text-on-surface-variant">{svc.detail}</p>}
                  <p className="mt-2 text-[10px] text-on-surface-variant">Checked {timeAgo(svc.lastCheckedAt)}</p>
                </div>
              )
            })}
      </div>

      {/* Firebase / Social / PayPal breakdown */}
      {!loading && (
        <div className="pib-card p-4">
          <h2 className="font-headline font-semibold text-on-surface mb-3">Breakdown</h2>
          <div className="grid gap-3 sm:grid-cols-3 text-sm">
            {[
              { label: 'Firebase', keys: ['firestore', 'auth'] },
              { label: 'PayPal', keys: ['paypal'] },
              { label: 'Social', keys: ['social'] },
            ].map((group) => (
              <div key={group.label} className="rounded-lg border border-outline/40 p-3">
                <p className="text-[10px] uppercase tracking-wide text-on-surface-variant mb-2">{group.label}</p>
                <div className="space-y-1.5">
                  {group.keys.map((k) => {
                    const svc = services.find((s) => s.key === k)
                    if (!svc) return null
                    const meta = STATUS_META[svc.status]
                    return (
                      <div key={k} className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-on-surface">
                          <span className={`inline-block w-2 h-2 rounded-full ${meta.dot}`} />
                          {svc.name}
                        </span>
                        <span className="font-mono text-xs text-on-surface-variant">
                          {fmtLatency(svc.latencyMs, svc.latencyInstrumented)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Incidents */}
      <div className="pib-card p-4">
        <h2 className="font-headline font-semibold text-on-surface mb-1">Incidents (30d)</h2>
        <p className="text-xs text-on-surface-variant mb-3">{uptimeNote}</p>
        {incidents.length === 0 ? (
          <p className="text-sm text-on-surface-variant py-4 text-center">
            No degraded/down periods recorded in the last 30 days.
          </p>
        ) : (
          <div className="space-y-2">
            {incidents.map((inc, i) => (
              <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-outline/40 p-2.5 text-sm">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${inc.worstStatus === 'down' ? 'bg-red-500' : 'bg-amber-500'}`}
                  />
                  <span className="text-on-surface font-label">{inc.serviceName}</span>
                  <span className={`text-xs ${inc.worstStatus === 'down' ? 'text-red-400' : 'text-amber-400'}`}>
                    {inc.worstStatus}
                  </span>
                </div>
                <div className="text-xs text-on-surface-variant">
                  {new Date(inc.startedAt).toLocaleString()} → {inc.endedAt ? new Date(inc.endedAt).toLocaleString() : 'ongoing'}{' '}
                  ({inc.checks} chk)
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Alert settings */}
      <form onSubmit={saveAlerts} className="pib-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-headline font-semibold text-on-surface">Alert Settings</h2>
          {!isSuperAdmin && (
            <span className="text-xs text-on-surface-variant">Super admin only — view only</span>
          )}
        </div>
        <div className="space-y-2">
          {Object.entries(alerts).map(([key, cfg]) => {
            const svc = services.find((s) => s.key === key)
            return (
              <div key={key} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg border border-outline/40 p-2.5">
                <span className="text-sm text-on-surface font-label capitalize">{svc?.name ?? key}</span>
                <label className="flex items-center gap-1.5 text-xs text-on-surface-variant">
                  threshold
                  <input
                    type="number"
                    min={1}
                    className="pib-input w-24 text-sm font-mono"
                    value={cfg.latencyThresholdMs}
                    disabled={!isSuperAdmin}
                    onChange={(e) =>
                      setAlerts((p) => ({ ...p, [key]: { ...p[key], latencyThresholdMs: Number(e.target.value) } }))
                    }
                  />
                  ms
                </label>
                <label className="flex items-center gap-1.5 text-xs text-on-surface-variant">
                  <input
                    type="checkbox"
                    checked={cfg.enabled}
                    disabled={!isSuperAdmin}
                    onChange={(e) => setAlerts((p) => ({ ...p, [key]: { ...p[key], enabled: e.target.checked } }))}
                  />
                  enabled
                </label>
              </div>
            )
          })}
        </div>
        {isSuperAdmin && (
          <div className="flex items-center gap-3">
            <button type="submit" disabled={savingAlerts} className="pib-btn-primary text-sm font-label disabled:opacity-50">
              {savingAlerts ? 'Saving…' : 'Save thresholds'}
            </button>
            {alertsMsg && <span className="text-xs text-on-surface-variant">{alertsMsg}</span>}
          </div>
        )}
      </form>
    </div>
  )
}
