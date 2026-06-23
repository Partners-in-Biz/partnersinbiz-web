'use client'

import { useCallback, useEffect, useState } from 'react'

interface Metrics {
  ramMB: number | null
  cpuPct: number | null
  diskPct: number | null
  loadAvg: number | null
  pid: number | null
  restartCount: number | null
  requestsToday: number | null
  uptimeSeconds: number | null
}

interface Server {
  kind: 'agent'
  agentId: string
  name: string
  baseUrl: string
  host: string
  enabled: boolean
  status: 'ok' | 'degraded' | 'down'
  probedPath: string | null
  lastHeartbeat: string | null
  metrics: Metrics
  notInstrumented: string[]
  error: string | null
}

interface PlatformService {
  kind: 'service'
  key: string
  name: string
  status: 'ok' | 'degraded' | 'down' | 'not-configured'
  latencyMs: number | null
  latencyInstrumented: boolean
  detail: string | null
}

interface Thresholds {
  cpuPct: number
  ramPct: number
  diskPct: number
  heartbeatStaleMinutes: number
}

const STATUS_DOT: Record<string, string> = {
  ok: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  down: 'bg-red-500',
  'not-configured': 'bg-white/30',
}
const STATUS_TEXT: Record<string, string> = {
  ok: 'text-emerald-400',
  degraded: 'text-amber-400',
  down: 'text-red-400',
  'not-configured': 'text-on-surface-variant',
}

const METRIC_LABELS: Array<{ key: keyof Metrics; label: string; fmt: (v: number) => string }> = [
  { key: 'cpuPct', label: 'CPU', fmt: (v) => `${v}%` },
  { key: 'ramMB', label: 'RAM', fmt: (v) => `${v} MB` },
  { key: 'diskPct', label: 'Disk', fmt: (v) => `${v}%` },
  { key: 'loadAvg', label: 'Load', fmt: (v) => `${v}` },
  { key: 'uptimeSeconds', label: 'Uptime', fmt: (v) => fmtUptime(v) },
  { key: 'pid', label: 'PID', fmt: (v) => `${v}` },
  { key: 'restartCount', label: 'Restarts', fmt: (v) => `${v}` },
  { key: 'requestsToday', label: 'Reqs today', fmt: (v) => `${v}` },
]

function fmtUptime(s: number): string {
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const d = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(d)) return '—'
  const s = Math.floor(d / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

export default function InfrastructureClient() {
  const [servers, setServers] = useState<Server[]>([])
  const [platformServices, setPlatformServices] = useState<PlatformService[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [thresholds, setThresholds] = useState<Thresholds | null>(null)
  const [alertsEnabled, setAlertsEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/admin/system/infrastructure')
      const body = await res.json()
      const data = body.data ?? body
      if (!res.ok) {
        setError(body?.error ?? 'Failed to load infrastructure')
        return
      }
      setServers(data.servers ?? [])
      setPlatformServices(data.platformServices ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load infrastructure')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadAlerts = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/admin/system/infrastructure/alerts')
      const body = await res.json()
      const data = body.data ?? body
      if (res.ok) {
        setThresholds(data.thresholds)
        setAlertsEnabled(Boolean(data.enabled))
      }
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    load()
    loadAlerts()
    fetch('/api/auth/verify')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setIsSuperAdmin(Boolean(s?.isSuperAdmin)))
      .catch(() => setIsSuperAdmin(false))
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [load, loadAlerts])

  async function saveAlerts(e: React.FormEvent) {
    e.preventDefault()
    if (!thresholds) return
    setSaving(true)
    setSavedMsg(null)
    try {
      const res = await fetch('/api/v1/admin/system/infrastructure/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: alertsEnabled, thresholds }),
      })
      const body = await res.json()
      if (!res.ok) setSavedMsg(body?.error ?? 'Failed to save')
      else setSavedMsg('Saved')
    } catch (err) {
      setSavedMsg(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">System</p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Infrastructure</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            VPS agent hosts and platform services. Metrics are pulled live from each Hermes sidecar — fields the
            sidecar does not expose are shown as &ldquo;not instrumented&rdquo;. Refreshes every 60s.
          </p>
        </div>
        <button onClick={load} className="pib-btn-ghost text-sm font-label flex items-center gap-1.5 shrink-0">
          <span className="material-symbols-outlined text-[16px]">refresh</span>
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
      )}

      {/* Agent / host cards */}
      <div>
        <h2 className="font-headline font-semibold text-on-surface mb-3">Agent Hosts</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)
            : servers.length === 0
              ? <p className="text-sm text-on-surface-variant">No agents registered.</p>
              : servers.map((srv) => (
                  <div key={srv.agentId} className="pib-card p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`inline-block w-2.5 h-2.5 rounded-full ${STATUS_DOT[srv.status]}`} />
                          <h3 className="font-headline font-semibold text-on-surface">{srv.name}</h3>
                        </div>
                        <p className="text-xs font-mono text-on-surface-variant mt-0.5">{srv.host}</p>
                      </div>
                      <span className={`text-xs font-label ${STATUS_TEXT[srv.status]}`}>{srv.status}</span>
                    </div>

                    <p className="mt-2 text-[10px] text-on-surface-variant">
                      Heartbeat {timeAgo(srv.lastHeartbeat)}
                      {srv.probedPath && <span className="font-mono"> · {srv.probedPath}</span>}
                    </p>

                    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                      {METRIC_LABELS.map(({ key, label, fmt }) => {
                        const v = srv.metrics[key]
                        return (
                          <div key={key} className="flex items-center justify-between gap-2">
                            <span className="text-[11px] uppercase tracking-wide text-on-surface-variant">{label}</span>
                            {v === null ? (
                              <span className="text-xs text-on-surface-variant italic">not instrumented</span>
                            ) : (
                              <span className="font-mono text-on-surface">{fmt(v)}</span>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {srv.error && (
                      <p className="mt-3 text-xs text-red-300/80 break-words">{srv.error}</p>
                    )}
                  </div>
                ))}
        </div>
      </div>

      {/* Platform services */}
      {!loading && platformServices.length > 0 && (
        <div className="pib-card p-4">
          <h2 className="font-headline font-semibold text-on-surface mb-3">Platform Services</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {platformServices.map((svc) => (
              <div key={svc.key} className="flex items-center justify-between gap-2 rounded-lg border border-outline/40 p-2.5">
                <span className="flex items-center gap-2 text-sm text-on-surface">
                  <span className={`inline-block w-2 h-2 rounded-full ${STATUS_DOT[svc.status]}`} />
                  {svc.name}
                </span>
                <span className="font-mono text-xs text-on-surface-variant">
                  {svc.latencyInstrumented ? (svc.latencyMs === null ? '—' : `${svc.latencyMs} ms`) : 'not instrumented'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Alert thresholds */}
      {thresholds && (
        <form onSubmit={saveAlerts} className="pib-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-headline font-semibold text-on-surface">Alert Thresholds</h2>
            <label className="flex items-center gap-1.5 text-xs text-on-surface-variant">
              <input
                type="checkbox"
                checked={alertsEnabled}
                disabled={!isSuperAdmin}
                onChange={(e) => setAlertsEnabled(e.target.checked)}
              />
              alerts enabled
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ['cpuPct', 'CPU above (%)'],
              ['ramPct', 'RAM above (%)'],
              ['diskPct', 'Disk above (%)'],
              ['heartbeatStaleMinutes', 'Heartbeat stale (min)'],
            ] as Array<[keyof Thresholds, string]>).map(([key, label]) => (
              <label key={key} className="space-y-1">
                <span className="text-[10px] uppercase tracking-wide text-on-surface-variant block">{label}</span>
                <input
                  type="number"
                  min={1}
                  className="pib-input w-full text-sm font-mono"
                  value={thresholds[key]}
                  disabled={!isSuperAdmin}
                  onChange={(e) => setThresholds({ ...thresholds, [key]: Number(e.target.value) })}
                />
              </label>
            ))}
          </div>
          {isSuperAdmin ? (
            <div className="flex items-center gap-3">
              <button type="submit" disabled={saving} className="pib-btn-primary text-sm font-label disabled:opacity-50">
                {saving ? 'Saving…' : 'Save thresholds'}
              </button>
              {savedMsg && <span className="text-xs text-on-surface-variant">{savedMsg}</span>}
            </div>
          ) : (
            <p className="text-xs text-on-surface-variant">Super admin only — view only.</p>
          )}
        </form>
      )}
    </div>
  )
}
