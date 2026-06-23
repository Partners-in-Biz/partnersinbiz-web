'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'

interface Delivery {
  id: string
  webhookId: string
  webhookName: string
  webhookUrl: string
  queueItemId: string
  orgId: string
  event: string
  payloadHash: string
  responseStatus: number | null
  responseBody: string
  durationMs: number | null
  attemptNumber: number | null
  error: string | null
  deliveredAtMs: number | null
  isSuccess: boolean
}

interface ListData {
  deliveries: Delivery[]
  total: number
  scanned: number
  scanCapped: boolean
  _note?: string
}

interface Breakdown {
  byEvent: { event: string; count: number }[]
  byStatus: { success: number; failed: number; total: number }
  perOrg: { orgId: string; total: number; success: number; failed: number; successRate: number }[]
  scanCapped: boolean
}

interface SessionInfo {
  isSuperAdmin?: boolean
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function fmtTime(ms: number | null): string {
  if (ms === null) return '—'
  return new Date(ms).toLocaleString()
}

function statusColor(d: Delivery): string {
  if (d.isSuccess) return 'text-emerald-400'
  if (d.responseStatus === null) return 'text-amber-400'
  return 'text-red-400'
}

export default function WebhooksClient() {
  const [list, setList] = useState<ListData | null>(null)
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)

  // Filters
  const [orgId, setOrgId] = useState('')
  const [webhookId, setWebhookId] = useState('')
  const [event, setEvent] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const [expanded, setExpanded] = useState<string | null>(null)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams()
    if (orgId.trim()) p.set('orgId', orgId.trim())
    if (webhookId.trim()) p.set('webhookId', webhookId.trim())
    if (event.trim()) p.set('event', event.trim())
    if (status) p.set('status', status)
    if (from) p.set('from', new Date(from).toISOString())
    if (to) p.set('to', new Date(to).toISOString())
    p.set('limit', '150')
    return p.toString()
  }, [orgId, webhookId, event, status, from, to])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const q = buildQuery()
      const [listRes, bdRes] = await Promise.all([
        fetch(`/api/v1/admin/system/webhooks?${q}`),
        fetch(`/api/v1/admin/system/webhooks/breakdown`),
      ])
      const listBody = await listRes.json()
      const bdBody = await bdRes.json()
      if (!listRes.ok) throw new Error(listBody?.error || 'Failed to load deliveries')
      setList(listBody.data ?? listBody)
      setBreakdown(bdBody.data ?? bdBody)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [buildQuery])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/verify')
      .then((r) => (r.ok ? r.json() : null))
      .then((s: SessionInfo | null) => {
        if (!cancelled) setIsSuperAdmin(Boolean(s?.isSuperAdmin))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  async function retry(deliveryId: string) {
    setRetrying(deliveryId)
    try {
      const res = await fetch(`/api/v1/admin/system/webhooks/${deliveryId}/retry`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Retry failed')
      setToast(`Requeued — new queue item ${body.data?.newQueueItemId ?? ''}`)
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Retry failed')
    } finally {
      setRetrying(null)
      setTimeout(() => setToast(null), 4000)
    }
  }

  const maxEventCount = breakdown?.byEvent.reduce((m, e) => Math.max(m, e.count), 0) ?? 0

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
            System / Ops
          </p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Webhook Event Log</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Platform-wide outbound webhook deliveries. Inspect payload hashes, response bodies, per-org
            delivery health, and requeue failed deliveries.
          </p>
        </div>
        <button onClick={load} className="pib-btn-ghost text-sm font-label flex items-center gap-1.5" title="Refresh">
          <span className="material-symbols-outlined text-[16px]">refresh</span>
          Refresh
        </button>
      </div>

      {toast && (
        <div className="pib-card border border-emerald-500/30 bg-emerald-500/5 px-4 py-2 text-sm text-emerald-300">
          {toast}
        </div>
      )}
      {error && (
        <div className="pib-card border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {/* Status + breakdown */}
      {loading && !breakdown ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : breakdown ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="pib-card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-label uppercase tracking-wide text-on-surface-variant">Deliveries by event</h2>
              <span className="text-xs text-on-surface-variant">
                {breakdown.byStatus.total} total
                {breakdown.scanCapped ? ' (recent slice)' : ''}
              </span>
            </div>
            <div className="mt-4">
              <svg viewBox={`0 0 400 ${Math.max(40, breakdown.byEvent.length * 22)}`} className="w-full" role="img">
                {breakdown.byEvent.slice(0, 12).map((e, i) => {
                  const w = maxEventCount > 0 ? (e.count / maxEventCount) * 250 : 0
                  return (
                    <g key={e.event} transform={`translate(0, ${i * 22})`}>
                      <text x="0" y="13" className="fill-current text-on-surface-variant" fontSize="10">
                        {e.event.length > 20 ? e.event.slice(0, 19) + '…' : e.event}
                      </text>
                      <rect x="140" y="3" width={w} height="13" rx="2" className="fill-current text-blue-500/70" />
                      <text x={140 + w + 4} y="13" className="fill-current text-on-surface" fontSize="10">
                        {e.count}
                      </text>
                    </g>
                  )
                })}
              </svg>
            </div>
            <div className="mt-3 flex gap-4 text-xs">
              <span className="text-emerald-400">● {breakdown.byStatus.success} success</span>
              <span className="text-red-400">● {breakdown.byStatus.failed} failed</span>
            </div>
          </div>

          <div className="pib-card p-4">
            <h2 className="text-sm font-label uppercase tracking-wide text-on-surface-variant">Per-org delivery health</h2>
            <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
              {breakdown.perOrg.length === 0 ? (
                <p className="text-xs text-on-surface-variant">No deliveries recorded yet.</p>
              ) : (
                breakdown.perOrg.map((o) => (
                  <div key={o.orgId} className="flex items-center gap-3">
                    <span className="font-mono text-xs text-on-surface-variant w-40 truncate" title={o.orgId}>
                      {o.orgId}
                    </span>
                    <div className="flex-1 h-2 rounded bg-white/10 overflow-hidden">
                      <div
                        className={`h-full ${o.successRate >= 95 ? 'bg-emerald-500' : o.successRate >= 80 ? 'bg-amber-500' : 'bg-red-500'}`}
                        style={{ width: `${o.successRate}%` }}
                      />
                    </div>
                    <span className="text-xs text-on-surface w-28 text-right">
                      {o.successRate}% ({o.success}/{o.total})
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      ) : null}

      {/* Filters */}
      <section className="pib-card p-4">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <label className="space-y-1">
            <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">Org ID</span>
            <input className="pib-input w-full font-mono text-xs" value={orgId} onChange={(e) => setOrgId(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">Webhook ID</span>
            <input className="pib-input w-full font-mono text-xs" value={webhookId} onChange={(e) => setWebhookId(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">Event</span>
            <input className="pib-input w-full text-xs" value={event} onChange={(e) => setEvent(e.target.value)} placeholder="invoice.paid" />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">Status</span>
            <select className="pib-input w-full text-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="success">Success (2xx)</option>
              <option value="failed">Failed</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">From</span>
            <input type="datetime-local" className="pib-input w-full text-xs" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">To</span>
            <input type="datetime-local" className="pib-input w-full text-xs" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={() => { setOrgId(''); setWebhookId(''); setEvent(''); setStatus(''); setFrom(''); setTo('') }}
            className="pib-btn-ghost text-xs font-label"
          >
            Clear
          </button>
          <button onClick={load} className="pib-btn-primary text-xs font-label flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[14px]">filter_alt</span>
            Apply
          </button>
        </div>
      </section>

      {/* Deliveries table */}
      <section className="pib-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <h2 className="text-sm font-label uppercase tracking-wide text-on-surface-variant">Deliveries</h2>
          {list && (
            <span className="text-xs text-on-surface-variant">
              {list.deliveries.length} shown · {list.total} matched
              {list.scanCapped ? ' · recent slice only' : ''}
            </span>
          )}
        </div>
        {loading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 rounded" />)}
          </div>
        ) : !list || list.deliveries.length === 0 ? (
          <div className="p-10 text-center text-sm text-on-surface-variant">No deliveries match these filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-on-surface-variant border-b border-white/10">
                  <th className="px-3 py-2 font-label">Event</th>
                  <th className="px-3 py-2 font-label">Org</th>
                  <th className="px-3 py-2 font-label">Webhook</th>
                  <th className="px-3 py-2 font-label">Status</th>
                  <th className="px-3 py-2 font-label">Duration</th>
                  <th className="px-3 py-2 font-label">Attempt</th>
                  <th className="px-3 py-2 font-label">Time</th>
                  <th className="px-3 py-2 font-label"></th>
                </tr>
              </thead>
              <tbody>
                {list.deliveries.map((d) => (
                  <Fragment key={d.id}>
                    <tr
                      className="border-b border-white/5 hover:bg-white/5 cursor-pointer"
                      onClick={() => setExpanded(expanded === d.id ? null : d.id)}
                    >
                      <td className="px-3 py-2 text-on-surface">{d.event}</td>
                      <td className="px-3 py-2 font-mono text-on-surface-variant truncate max-w-[120px]" title={d.orgId}>{d.orgId || '—'}</td>
                      <td className="px-3 py-2 text-on-surface-variant truncate max-w-[140px]" title={d.webhookUrl}>{d.webhookName || d.webhookId}</td>
                      <td className={`px-3 py-2 font-mono ${statusColor(d)}`}>{d.responseStatus ?? (d.error ? 'ERR' : '—')}</td>
                      <td className="px-3 py-2 text-on-surface-variant">{d.durationMs !== null ? `${d.durationMs}ms` : '—'}</td>
                      <td className="px-3 py-2 text-on-surface-variant">{d.attemptNumber ?? '—'}</td>
                      <td className="px-3 py-2 text-on-surface-variant whitespace-nowrap">{fmtTime(d.deliveredAtMs)}</td>
                      <td className="px-3 py-2 text-right">
                        {!d.isSuccess && isSuperAdmin && (
                          <button
                            onClick={(e) => { e.stopPropagation(); retry(d.id) }}
                            disabled={retrying === d.id}
                            className="pib-btn-ghost text-[11px] font-label flex items-center gap-1 disabled:opacity-50"
                          >
                            <span className="material-symbols-outlined text-[13px]">replay</span>
                            {retrying === d.id ? '...' : 'Retry'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expanded === d.id && (
                      <tr className="bg-black/20">
                        <td colSpan={8} className="px-4 py-3">
                          <div className="grid gap-3 sm:grid-cols-2 text-xs">
                            <div className="space-y-1">
                              <p><span className="text-on-surface-variant">Delivery ID:</span> <span className="font-mono">{d.id}</span></p>
                              <p><span className="text-on-surface-variant">Queue item:</span> <span className="font-mono">{d.queueItemId || '—'}</span></p>
                              <p><span className="text-on-surface-variant">Webhook URL:</span> <span className="font-mono break-all">{d.webhookUrl || '—'}</span></p>
                              <p><span className="text-on-surface-variant">Payload hash:</span> <span className="font-mono break-all">{d.payloadHash || '—'}</span></p>
                            </div>
                            <div className="space-y-1">
                              <p><span className="text-on-surface-variant">Response status:</span> <span className="font-mono">{d.responseStatus ?? '—'}</span></p>
                              {d.error && <p className="text-red-400">Error: {d.error}</p>}
                              <p className="text-on-surface-variant">Response body:</p>
                              <pre className="bg-black/40 rounded p-2 overflow-x-auto max-h-40 text-[10px] text-on-surface-variant whitespace-pre-wrap">
                                {d.responseBody || '(empty)'}
                              </pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list?._note && <div className="px-4 py-2 text-[11px] text-on-surface-variant border-t border-white/10">{list._note}</div>}
      </section>
    </div>
  )
}
