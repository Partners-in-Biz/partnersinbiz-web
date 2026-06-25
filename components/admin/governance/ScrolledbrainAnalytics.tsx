// components/admin/governance/ScrolledbrainAnalytics.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'

type Period = '7d' | '30d' | '90d'

interface PeriodStats {
  events: number
  sessions: number
  topPages: Array<{ page: string; views: number }>
}

interface ErrorRow {
  id: string
  event: string
  reason: string
  error: string
  failedAt: string
  retriedAt: string
}

interface EnvCheck {
  key: string
  label: string
  ok: boolean
  detail: string
}

interface Result {
  found: boolean
  property: {
    id: string
    name: string
    domain: string
    orgId: string
    status: string
    ingestKeyPresent: boolean
    ingestKeyRotatedAt: string
  } | null
  period: Period
  current: PeriodStats
  previous: PeriodStats
  comparison: {
    eventsDeltaPct: number | null
    sessionsDeltaPct: number | null
    currentWindow: { fromIso: string; toIso: string }
    previousWindow: { fromIso: string; toIso: string }
  }
  errors: ErrorRow[]
  envSync: {
    propertyId: string
    domain: string
    ingestEndpoint: string
    sdkSnippet: string
    vercelAnalyticsEnvPresent: boolean
    checks: EnvCheck[]
  } | null
  scope: 'all' | 'restricted'
}

function Delta({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-[11px] text-on-surface-variant">new</span>
  const up = pct >= 0
  return (
    <span className={`text-[11px] ${up ? 'text-green-300' : 'text-red-300'}`}>
      {up ? '▲' : '▼'} {Math.abs(pct)}%
    </span>
  )
}

export function ScrolledbrainAnalytics() {
  const [period, setPeriod] = useState<Period>('30d')
  const [data, setData] = useState<Result | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const [rotating, setRotating] = useState(false)
  const [revealedKey, setRevealedKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/admin/analytics/scrolledbrain?period=${period}`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Failed to load')
      setData(body.data ?? body)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load Scrolledbrain analytics.')
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    load()
  }, [load])

  const rotateKey = useCallback(async () => {
    if (!data?.property) return
    if (!window.confirm('Rotate the Scrolledbrain ingest key? Existing SDK installs must be updated with the new key.')) {
      return
    }
    setRotating(true)
    setNotice(null)
    try {
      const res = await fetch('/api/v1/admin/analytics/scrolledbrain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rotate-ingest-key', propertyId: data.property.id }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Rotation failed')
      const payload = body.data ?? body
      setRevealedKey(payload.ingestKey)
      setNotice({ tone: 'ok', text: 'Ingest key rotated. Copy it now — it is shown once.' })
      await load()
    } catch (e) {
      setNotice({ tone: 'err', text: e instanceof Error ? e.message : 'Rotation failed.' })
    } finally {
      setRotating(false)
    }
  }, [data, load])

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">Analytics</p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Scrolledbrain Analytics</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Dedicated ingest + usage view for the Scrolledbrain property, with period comparison, an ingestion error
            log, and env-sync controls.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-[var(--color-card-border)] p-0.5">
          {(['7d', '30d', '90d'] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                period === p ? 'bg-[var(--color-accent-v2)] text-black' : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <div
          className={`rounded-lg border px-3 py-2 text-xs ${
            notice.tone === 'ok'
              ? 'border-green-500/20 bg-green-500/10 text-green-300'
              : 'border-red-500/20 bg-red-500/10 text-red-300'
          }`}
        >
          {notice.text}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
      )}

      {loading ? (
        <div className="pib-card text-sm text-on-surface-variant">Loading…</div>
      ) : !data?.found || !data.property ? (
        <div className="pib-card text-sm text-on-surface-variant">
          No property with a scrolledbrain domain is available in this admin scope.
        </div>
      ) : (
        <>
          {/* Period-compare metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="pib-card">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Events ({period})</p>
              <p className="text-2xl font-headline font-bold text-on-surface mt-1">{data.current.events}</p>
              <div className="mt-0.5 flex items-center gap-1.5">
                <Delta pct={data.comparison.eventsDeltaPct} />
                <span className="text-[11px] text-on-surface-variant">vs prev {data.previous.events}</span>
              </div>
            </div>
            <div className="pib-card">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Sessions ({period})</p>
              <p className="text-2xl font-headline font-bold text-on-surface mt-1">{data.current.sessions}</p>
              <div className="mt-0.5 flex items-center gap-1.5">
                <Delta pct={data.comparison.sessionsDeltaPct} />
                <span className="text-[11px] text-on-surface-variant">vs prev {data.previous.sessions}</span>
              </div>
            </div>
            <div className="pib-card">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Status</p>
              <p className="text-lg font-headline font-bold text-on-surface mt-1">{data.property.status}</p>
              <p className="text-[11px] text-on-surface-variant mt-0.5 font-mono break-all">{data.property.id}</p>
            </div>
            <div className="pib-card">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Ingest errors</p>
              <p className="text-2xl font-headline font-bold text-on-surface mt-1">{data.errors.length}</p>
              <p className="text-[11px] text-on-surface-variant mt-0.5">dead-letter records</p>
            </div>
          </div>

          <p className="text-[11px] text-on-surface-variant">
            Current window {data.comparison.currentWindow.fromIso} → {data.comparison.currentWindow.toIso} · Previous{' '}
            {data.comparison.previousWindow.fromIso} → {data.comparison.previousWindow.toIso}
          </p>

          {/* Top pages compare */}
          <div className="overflow-x-auto rounded-xl border border-[var(--color-card-border)]">
            <table className="w-full text-left text-sm text-on-surface">
              <thead>
                <tr className="border-b border-[var(--color-card-border)] bg-[var(--color-surface-container)]">
                  {['Page', 'Views (current)', 'Views (previous)'].map((c) => (
                    <th key={c} className="px-3 py-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.current.topPages.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-on-surface-variant">
                      No stored page events for this window.
                    </td>
                  </tr>
                ) : (
                  data.current.topPages.map((row) => {
                    const prev = data.previous.topPages.find((p) => p.page === row.page)?.views ?? 0
                    return (
                      <tr key={row.page} className="border-b border-[var(--color-card-border)] last:border-b-0">
                        <td className="px-3 py-2 font-mono text-xs break-all">{row.page}</td>
                        <td className="px-3 py-2 text-on-surface-variant">{row.views}</td>
                        <td className="px-3 py-2 text-on-surface-variant">{prev}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Error log */}
          <div className="pib-card space-y-3">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Ingestion error log</p>
            {data.errors.length === 0 ? (
              <p className="text-sm text-on-surface-variant">No ingestion errors recorded for this property.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-on-surface">
                  <thead>
                    <tr className="border-b border-[var(--color-card-border)]">
                      {['Event', 'Reason', 'Error', 'Failed at'].map((c) => (
                        <th key={c} className="px-2 py-1.5 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.errors.map((e) => (
                      <tr key={e.id} className="border-b border-[var(--color-card-border)] last:border-b-0">
                        <td className="px-2 py-1.5 text-xs">{e.event}</td>
                        <td className="px-2 py-1.5 text-xs text-amber-300/80">{e.reason || '—'}</td>
                        <td className="px-2 py-1.5 text-xs text-on-surface-variant max-w-[280px] break-words">{e.error || '—'}</td>
                        <td className="px-2 py-1.5 text-xs text-on-surface-variant whitespace-nowrap">{e.failedAt || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Env-sync controls */}
          {data.envSync && (
            <div className="pib-card space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Env sync</p>
                <button
                  type="button"
                  disabled={rotating}
                  onClick={rotateKey}
                  className="rounded-lg border border-[var(--color-card-border)] px-3 py-1.5 text-xs text-on-surface hover:bg-[var(--color-row-hover)] disabled:opacity-50 transition-colors"
                >
                  {rotating ? 'Rotating…' : 'Rotate ingest key'}
                </button>
              </div>

              {revealedKey && (
                <div className="rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2">
                  <p className="text-[11px] text-green-300 mb-1">New ingest key (shown once):</p>
                  <code className="block text-xs font-mono text-on-surface break-all">{revealedKey}</code>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {data.envSync.checks.map((c) => (
                  <div
                    key={c.key}
                    className="flex items-start gap-2 rounded-lg border border-[var(--color-card-border)] px-3 py-2"
                  >
                    <span className={`mt-0.5 text-sm ${c.ok ? 'text-green-300' : 'text-amber-300'}`}>{c.ok ? '✓' : '!'}</span>
                    <div>
                      <p className="text-xs font-medium text-on-surface">{c.label}</p>
                      <p className="text-[11px] text-on-surface-variant">{c.detail}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-1 text-[11px] text-on-surface-variant">
                <p>
                  Ingest endpoint: <span className="font-mono text-on-surface">{data.envSync.ingestEndpoint}</span>
                </p>
                <pre className="mt-1 overflow-x-auto rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] p-3 text-[11px] text-on-surface font-mono whitespace-pre-wrap">
                  {data.envSync.sdkSnippet}
                </pre>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
