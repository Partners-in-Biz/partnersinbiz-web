'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'

type Severity = 'info' | 'warning' | 'error' | 'critical'

interface ErrorEvent {
  id: string
  message: string
  stack: string | null
  severity: Severity
  orgId: string | null
  source: string
  route: string | null
  resolvedAt: number | null
  assignedTo: string | null
  createdAt: number | null
}

const SEVERITY_META: Record<Severity, string> = {
  info: 'bg-sky-500/15 text-sky-400',
  warning: 'bg-amber-500/15 text-amber-400',
  error: 'bg-red-500/15 text-red-400',
  critical: 'bg-fuchsia-500/15 text-fuchsia-400',
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function fmtTime(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString()
}

export default function LogsClient() {
  const [events, setEvents] = useState<ErrorEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [empty, setEmpty] = useState(false)
  const [sentryUrl, setSentryUrl] = useState<string | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  // filters
  const [severity, setSeverity] = useState('')
  const [orgId, setOrgId] = useState('')
  const [resolved, setResolved] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (severity) params.set('severity', severity)
    if (orgId) params.set('orgId', orgId)
    if (resolved) params.set('resolved', resolved)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    try {
      const res = await fetch(`/api/v1/admin/system/logs?${params.toString()}`)
      const body = await res.json()
      const data = body.data ?? body
      if (!res.ok) {
        setError(body?.error ?? 'Failed to load logs')
        return
      }
      setEvents(data.events ?? [])
      setEmpty(Boolean(data.empty))
      setSentryUrl(data.sentryConfigured ? data.sentryUrl : null)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load logs')
    } finally {
      setLoading(false)
    }
  }, [severity, orgId, resolved, from, to])

  useEffect(() => {
    load()
    fetch('/api/auth/verify')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setIsSuperAdmin(Boolean(s?.isSuperAdmin)))
      .catch(() => setIsSuperAdmin(false))
  }, [load])

  async function patch(id: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/v1/admin/system/logs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) load()
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">System</p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Error Logs</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Captured error events from the <code className="font-mono text-xs">error_events</code> collection.
            Resolve and assign to track follow-up.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {sentryUrl && (
            <a
              href={sentryUrl}
              target="_blank"
              rel="noreferrer"
              className="pib-btn-ghost text-sm font-label flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px]">open_in_new</span>
              View in Sentry
            </a>
          )}
          <button onClick={load} className="pib-btn-ghost text-sm font-label flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]">refresh</span>
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="pib-card p-3 flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-on-surface-variant block">Severity</span>
          <select className="pib-input text-sm" value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">All</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
            <option value="critical">Critical</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-on-surface-variant block">Status</span>
          <select className="pib-input text-sm" value={resolved} onChange={(e) => setResolved(e.target.value)}>
            <option value="">All</option>
            <option value="false">Unresolved</option>
            <option value="true">Resolved</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-on-surface-variant block">Org ID</span>
          <input className="pib-input text-sm font-mono w-40" value={orgId} onChange={(e) => setOrgId(e.target.value)} placeholder="any" />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-on-surface-variant block">From</span>
          <input type="date" className="pib-input text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-on-surface-variant block">To</span>
          <input type="date" className="pib-input text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button onClick={load} className="pib-btn-primary text-sm font-label">Apply</button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
      )}

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
        </div>
      ) : events.length === 0 ? (
        <div className="pib-card p-10 text-center">
          <span className="material-symbols-outlined text-4xl text-on-surface-variant">check_circle</span>
          <p className="mt-2 text-sm font-label text-on-surface">
            {empty ? 'No error events recorded yet.' : 'No events match these filters.'}
          </p>
          <p className="mt-1 text-xs text-on-surface-variant">
            Events appear here as <code className="font-mono">logErrorEvent()</code> writes them.
          </p>
        </div>
      ) : (
        <div className="pib-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-outline/40 text-left text-[10px] uppercase tracking-wide text-on-surface-variant">
                <th className="p-3 font-label">Severity</th>
                <th className="p-3 font-label">Message</th>
                <th className="p-3 font-label">Source / Route</th>
                <th className="p-3 font-label">Org</th>
                <th className="p-3 font-label">When</th>
                <th className="p-3 font-label text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <Fragment key={ev.id}>
                  <tr
                    className="border-b border-outline/20 hover:bg-white/[0.02] cursor-pointer align-top"
                    onClick={() => setExpanded(expanded === ev.id ? null : ev.id)}
                  >
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-label ${SEVERITY_META[ev.severity]}`}>
                        {ev.severity}
                      </span>
                      {ev.resolvedAt && (
                        <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-label bg-emerald-500/15 text-emerald-400">
                          resolved
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-on-surface max-w-xs truncate">{ev.message}</td>
                    <td className="p-3 text-on-surface-variant text-xs">
                      <div className="font-mono">{ev.source}</div>
                      {ev.route && <div className="font-mono opacity-70">{ev.route}</div>}
                    </td>
                    <td className="p-3 text-on-surface-variant font-mono text-xs">{ev.orgId ?? '—'}</td>
                    <td className="p-3 text-on-surface-variant text-xs whitespace-nowrap">{fmtTime(ev.createdAt)}</td>
                    <td className="p-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {isSuperAdmin ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => patch(ev.id, { action: ev.resolvedAt ? 'unresolve' : 'resolve' })}
                            className="pib-btn-ghost text-xs font-label"
                          >
                            {ev.resolvedAt ? 'Reopen' : 'Resolve'}
                          </button>
                          <button
                            onClick={() => {
                              const uid = window.prompt('Assign to uid (blank to unassign):', ev.assignedTo ?? '')
                              if (uid !== null) patch(ev.id, { action: 'assign', assignedTo: uid || null })
                            }}
                            className="pib-btn-ghost text-xs font-label"
                          >
                            {ev.assignedTo ? 'Reassign' : 'Assign'}
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-on-surface-variant">{ev.assignedTo ? `→ ${ev.assignedTo}` : '—'}</span>
                      )}
                    </td>
                  </tr>
                  {expanded === ev.id && (
                    <tr className="border-b border-outline/20 bg-black/20">
                      <td colSpan={6} className="p-3">
                        {ev.assignedTo && (
                          <p className="text-xs text-on-surface-variant mb-2">Assigned to: <span className="font-mono">{ev.assignedTo}</span></p>
                        )}
                        {ev.stack ? (
                          <pre className="text-xs font-mono text-on-surface-variant whitespace-pre-wrap overflow-x-auto max-h-64">
                            {ev.stack}
                          </pre>
                        ) : (
                          <p className="text-xs text-on-surface-variant">No stack trace captured for this event.</p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
