// components/admin/governance/IngestionMonitor.tsx
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

interface SeriesPoint {
  hoursAgo: number
  count: number
}

interface DeadLetterItem {
  id: string
  orgId: string
  propertyId: string
  event: string
  sessionId: string
  reason: string
  pageUrl: string | null
  failedAtMs: number | null
}

interface TopProperty {
  propertyId: string
  name: string
  domain: string
  orgId: string
  volume: number
  lastSeenMs: number | null
}

interface RecentEvent {
  id: string
  event: string
  propertyId: string
  orgId: string
  sessionId: string
  path: string | null
  timestampMs: number
  latencyMs: number | null
}

interface PropertyOption {
  id: string
  name: string
  domain: string
  orgId: string
}

interface IngestionData {
  filters: { orgId: string | null; propertyId: string | null }
  counts: {
    lastHour: number
    lastDay: number
    lastWeek: number
    propertiesSeen: number
    scanned: number
  }
  series: SeriesPoint[]
  latency: {
    available: boolean
    p50Ms: number | null
    p95Ms: number | null
    sampleSize: number
    note: string
  }
  deadLetter: { count: number; items: DeadLetterItem[] }
  topProperties: TopProperty[]
  recentEvents: RecentEvent[]
  properties: PropertyOption[]
}

const card = 'rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-surface-container)] text-on-surface'
const input =
  'rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2 text-sm text-on-surface'

function fmtTime(ms: number | null): string {
  if (!ms) return 'n/a'
  return new Date(ms).toLocaleString()
}

function fmtMs(ms: number | null): string {
  if (ms == null) return 'n/a'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

function BarChart({ series }: { series: SeriesPoint[] }) {
  const width = 720
  const height = 160
  const padX = 8
  const padTop = 12
  const padBottom = 22
  const max = Math.max(1, ...series.map((p) => p.count))
  const barGap = 4
  const innerW = width - padX * 2
  const barW = series.length > 0 ? innerW / series.length - barGap : 0
  const innerH = height - padTop - padBottom

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label="Events received over the last 24 hours, bucketed hourly"
    >
      {series.map((p, i) => {
        const h = (p.count / max) * innerH
        const x = padX + i * (barW + barGap)
        const y = padTop + (innerH - h)
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={Math.max(1, barW)}
              height={Math.max(0, h)}
              rx={2}
              fill="var(--color-accent-v2)"
              opacity={p.count > 0 ? 0.85 : 0.25}
            >
              <title>{`${p.hoursAgo}h ago: ${p.count} events`}</title>
            </rect>
            {i % 4 === 0 && (
              <text
                x={x + barW / 2}
                y={height - 6}
                textAnchor="middle"
                fontSize="9"
                fill="currentColor"
                opacity={0.5}
              >
                {p.hoursAgo}h
              </text>
            )}
          </g>
        )
      })}
      <text x={padX} y={padTop} fontSize="9" fill="currentColor" opacity={0.5}>
        max {max}
      </text>
    </svg>
  )
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={`${card} px-4 py-3`}>
      <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{label}</p>
      <p className="mt-1 text-2xl font-headline font-bold text-on-surface">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-on-surface-variant/70">{hint}</p>}
    </div>
  )
}

export function IngestionMonitor() {
  const [data, setData] = useState<IngestionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [orgFilter, setOrgFilter] = useState('')
  const [propertyFilter, setPropertyFilter] = useState('')
  const [retrying, setRetrying] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (orgFilter) params.set('orgId', orgFilter)
    if (propertyFilter) params.set('propertyId', propertyFilter)
    const s = params.toString()
    return s ? `?${s}` : ''
  }, [orgFilter, propertyFilter])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/admin/analytics/ingestion${query}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Failed to load ingestion metrics')
      setData((body.data ?? body) as IngestionData)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load ingestion metrics.')
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    load()
  }, [load])

  const orgOptions = useMemo(() => {
    if (!data) return []
    return Array.from(new Set(data.properties.map((p) => p.orgId).filter(Boolean))).sort()
  }, [data])

  const propertyOptions = useMemo(() => {
    if (!data) return []
    return data.properties
      .filter((p) => !orgFilter || p.orgId === orgFilter)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [data, orgFilter])

  async function retry(id: string) {
    setRetrying(id)
    setFeedback(null)
    try {
      const res = await fetch('/api/v1/admin/analytics/ingestion/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Retry failed')
      setFeedback('Dead-letter event re-queued into product_events.')
      await load()
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Retry failed.')
    } finally {
      setRetrying(null)
    }
  }

  function exportCsv() {
    window.open(`/api/v1/admin/analytics/ingestion/export${query}`, '_blank')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
            Analytics ingestion
          </p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Ingestion monitor</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Live product_events flow, latency, top properties, and the dead-letter queue.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="block text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
              Organisation
            </span>
            <select
              className={input}
              value={orgFilter}
              onChange={(e) => {
                setOrgFilter(e.target.value)
                setPropertyFilter('')
              }}
            >
              <option value="">All organisations</option>
              {orgOptions.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
              Property
            </span>
            <select className={input} value={propertyFilter} onChange={(e) => setPropertyFilter(e.target.value)}>
              <option value="">All properties</option>
              {propertyOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.domain})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={load}
            className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2 text-sm text-on-surface hover:bg-[var(--color-row-hover)]"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="rounded-lg px-3 py-2 text-sm font-medium text-white"
            style={{ background: 'var(--color-accent-v2)' }}
          >
            Export CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
      )}
      {feedback && (
        <div className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2 text-xs text-on-surface">
          {feedback}
        </div>
      )}

      {loading && !data ? (
        <p className="text-sm text-on-surface-variant">Loading ingestion metrics…</p>
      ) : !data ? null : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Events (1h)" value={String(data.counts.lastHour)} />
            <Metric label="Events (24h)" value={String(data.counts.lastDay)} />
            <Metric label="Events (7d)" value={String(data.counts.lastWeek)} />
            <Metric label="Properties seen (7d)" value={String(data.counts.propertiesSeen)} />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Metric
              label="Latency p50"
              value={data.latency.available ? fmtMs(data.latency.p50Ms) : 'n/a'}
              hint={data.latency.available ? `${data.latency.sampleSize} samples` : 'no client clock'}
            />
            <Metric
              label="Latency p95"
              value={data.latency.available ? fmtMs(data.latency.p95Ms) : 'n/a'}
              hint={data.latency.available ? `${data.latency.sampleSize} samples` : 'no client clock'}
            />
            <Metric label="Dead-letter queue" value={String(data.deadLetter.count)} hint="failed events awaiting retry" />
          </div>

          {!data.latency.available && (
            <p className="text-[11px] text-on-surface-variant/70">{data.latency.note}</p>
          )}

          <div className={`${card} p-4`}>
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-3">
              Events received — last 24h (hourly)
            </p>
            <BarChart series={data.series} />
          </div>

          {/* Dead-letter list */}
          <div className={`${card} overflow-hidden`}>
            <div className="border-b border-[var(--color-card-border)] px-4 py-3">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                Dead-letter queue
              </p>
            </div>
            {data.deadLetter.items.length === 0 ? (
              <p className="px-4 py-6 text-sm text-on-surface-variant">
                No failed events in the dead-letter queue. Ingestion is healthy.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-card-border)] text-left text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                      <th className="px-4 py-2">Event</th>
                      <th className="px-4 py-2">Property</th>
                      <th className="px-4 py-2">Org</th>
                      <th className="px-4 py-2">Reason</th>
                      <th className="px-4 py-2">Failed</th>
                      <th className="px-4 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.deadLetter.items.map((d) => (
                      <tr key={d.id} className="border-b border-[var(--color-card-border)] last:border-b-0">
                        <td className="px-4 py-2 text-on-surface">{d.event}</td>
                        <td className="px-4 py-2 text-on-surface-variant">{d.propertyId}</td>
                        <td className="px-4 py-2 text-on-surface-variant">{d.orgId || 'unknown'}</td>
                        <td className="px-4 py-2 text-on-surface-variant">{d.reason}</td>
                        <td className="px-4 py-2 text-on-surface-variant">{fmtTime(d.failedAtMs)}</td>
                        <td className="px-4 py-2 text-right">
                          <button
                            type="button"
                            disabled={retrying === d.id}
                            onClick={() => retry(d.id)}
                            className="rounded-lg border border-[var(--color-card-border)] px-2.5 py-1 text-xs text-on-surface hover:bg-[var(--color-row-hover)] disabled:opacity-60"
                          >
                            {retrying === d.id ? 'Retrying…' : 'Retry'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Top properties */}
          <div className={`${card} overflow-hidden`}>
            <div className="border-b border-[var(--color-card-border)] px-4 py-3">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                Top properties by 7-day volume
              </p>
            </div>
            {data.topProperties.length === 0 ? (
              <p className="px-4 py-6 text-sm text-on-surface-variant">No events in the accessible scope.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-card-border)] text-left text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                      <th className="px-4 py-2">Property</th>
                      <th className="px-4 py-2">Domain</th>
                      <th className="px-4 py-2">Org</th>
                      <th className="px-4 py-2 text-right">Events</th>
                      <th className="px-4 py-2">Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topProperties.map((p) => (
                      <tr key={p.propertyId} className="border-b border-[var(--color-card-border)] last:border-b-0">
                        <td className="px-4 py-2 text-on-surface">{p.name}</td>
                        <td className="px-4 py-2 text-on-surface-variant">{p.domain}</td>
                        <td className="px-4 py-2 text-on-surface-variant">{p.orgId}</td>
                        <td className="px-4 py-2 text-right text-on-surface">{p.volume}</td>
                        <td className="px-4 py-2 text-on-surface-variant">{fmtTime(p.lastSeenMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Recent events */}
          <div className={`${card} overflow-hidden`}>
            <div className="border-b border-[var(--color-card-border)] px-4 py-3">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                Recent events ({data.counts.scanned} scanned)
              </p>
            </div>
            {data.recentEvents.length === 0 ? (
              <p className="px-4 py-6 text-sm text-on-surface-variant">No recent events.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-card-border)] text-left text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                      <th className="px-4 py-2">Event</th>
                      <th className="px-4 py-2">Property</th>
                      <th className="px-4 py-2">Session</th>
                      <th className="px-4 py-2">Path</th>
                      <th className="px-4 py-2">Latency</th>
                      <th className="px-4 py-2">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentEvents.map((e) => (
                      <tr key={e.id} className="border-b border-[var(--color-card-border)] last:border-b-0">
                        <td className="px-4 py-2 text-on-surface">{e.event}</td>
                        <td className="px-4 py-2 text-on-surface-variant">{e.propertyId}</td>
                        <td className="px-4 py-2 text-on-surface-variant font-mono text-xs">{e.sessionId}</td>
                        <td className="px-4 py-2 text-on-surface-variant">{e.path ?? 'n/a'}</td>
                        <td className="px-4 py-2 text-on-surface-variant">{fmtMs(e.latencyMs)}</td>
                        <td className="px-4 py-2 text-on-surface-variant">{fmtTime(e.timestampMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
