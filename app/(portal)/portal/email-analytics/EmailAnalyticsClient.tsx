'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { LineChart, Donut } from '@/components/admin/email-analytics/charts'
import type {
  OrgEmailOverview,
  EngagementTimeseries,
} from '@/lib/email-analytics/aggregate'

interface SequenceSummary {
  id: string
  name: string
  status: string
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

export function EmailAnalyticsClient({ orgId }: { orgId: string }) {
  const today = useMemo(() => new Date(), [])
  const thirtyDaysAgo = useMemo(
    () => new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000),
    [today],
  )
  const [from, setFrom] = useState<string>(isoDate(thirtyDaysAgo))
  const [to, setTo] = useState<string>(isoDate(today))
  const [state, setState] = useState<{
    overview: OrgEmailOverview | null
    series: EngagementTimeseries | null
    sequences: SequenceSummary[]
    loading: boolean
    key: string
    error: string
  }>({ overview: null, series: null, sequences: [], loading: true, key: '', error: '' })

  useEffect(() => {
    const key = `${from}|${to}|${orgId}`
    const fromIso = new Date(from).toISOString()
    const toIso = new Date(`${to}T23:59:59.999Z`).toISOString()
    const query = new URLSearchParams({ orgId, from: fromIso, to: toIso })
    const seriesQuery = new URLSearchParams({ orgId, from: fromIso, to: toIso, bucket: 'day' })
    let cancelled = false

    Promise.all([
      fetch(`/api/v1/email-analytics/overview?${query.toString()}`).then((r) => r.json()),
      fetch(`/api/v1/email-analytics/timeseries?${seriesQuery.toString()}`).then((r) => r.json()),
      fetch('/api/v1/crm/sequences').then((r) => r.json()),
    ]).then(([o, s, seq]) => {
      if (cancelled) return
      const error = o.error || s.error || ''
      const rawSequences = seq.data?.sequences ?? seq.data ?? []
      const sequences = Array.isArray(rawSequences)
        ? rawSequences
          .filter((item): item is SequenceSummary => (
            item &&
            typeof item.id === 'string' &&
            typeof item.name === 'string' &&
            item.status === 'active'
          ))
        : []
      setState({
        overview: o.data ?? null,
        series: s.data ?? null,
        sequences,
        loading: false,
        key,
        error,
      })
    }).catch((err: unknown) => {
      if (cancelled) return
      setState({
        overview: null,
        series: null,
        sequences: [],
        loading: false,
        key,
        error: err instanceof Error ? err.message : 'Failed to load analytics.',
      })
    })
    return () => {
      cancelled = true
    }
  }, [from, orgId, to])

  const loading = state.loading || state.key !== `${from}|${to}|${orgId}`
  const overview = state.overview
  const series = state.series
  const sequences = state.sequences

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-semibold">Email analytics</h1>
        <div className="flex items-center gap-2 text-sm">
          <label className="text-[var(--color-pib-text-muted)]">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="px-2 py-1 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] text-[var(--color-pib-text)]"
          />
          <label className="text-[var(--color-pib-text-muted)]">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="px-2 py-1 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] text-[var(--color-pib-text)]"
          />
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-white/5 animate-pulse" />
          ))}
        </div>
      ) : state.error ? (
        <p className="text-[var(--color-pib-text-muted)] text-sm">{state.error}</p>
      ) : !overview ? (
        <p className="text-[var(--color-pib-text-muted)] text-sm">No data available.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <PortalKpi label="Sent" value={overview.totals.sent} />
            <PortalKpi label="Delivered" value={overview.totals.delivered} sub={pct(overview.rates.deliveryRate)} />
            <PortalKpi label="Opened" value={overview.totals.opened} sub={pct(overview.rates.openRate) + ' open rate'} />
            <PortalKpi label="Clicked" value={overview.totals.clicked} sub={pct(overview.rates.clickRate) + ' CTR'} />
            <PortalKpi label="Bounced" value={overview.totals.bounced} sub={pct(overview.rates.bounceRate)} />
            <PortalKpi label="Unsubscribed" value={overview.totals.unsubscribed} sub={pct(overview.rates.unsubRate)} />
            <PortalKpi label="Failed" value={overview.totals.failed} />
            <PortalKpi label="CTR on opens" value={pct(overview.rates.ctrOnOpens)} />
          </div>

          {series && series.series.length > 0 && (
            <section>
              <h2 className="text-sm font-medium text-[var(--color-pib-text-muted)] mb-2">Engagement over time</h2>
              <div className="rounded-xl bg-white/[0.03] p-4">
                <LineChart
                  series={[
                    { name: 'Sent', points: series.series.map((s) => ({ x: s.date, y: s.sent })) },
                    { name: 'Opened', points: series.series.map((s) => ({ x: s.date, y: s.opened })) },
                    { name: 'Clicked', points: series.series.map((s) => ({ x: s.date, y: s.clicked })) },
                  ]}
                />
              </div>
            </section>
          )}

          <section>
            <h2 className="text-sm font-medium text-[var(--color-pib-text-muted)] mb-2">By source</h2>
            <div className="rounded-xl bg-white/[0.03] p-4">
              <Donut
                data={[
                  { label: 'Broadcasts', value: overview.bySource.broadcast.sent },
                  { label: 'Campaigns', value: overview.bySource.campaign.sent },
                  { label: 'Sequences', value: overview.bySource.sequence.sent },
                  { label: 'One-off', value: overview.bySource.oneOff.sent },
                ].filter((d) => d.value > 0)}
              />
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium text-[var(--color-pib-text-muted)]">
                Sequence performance
              </h2>
              <Link
                href="/portal/settings/sequences"
                className="text-xs font-medium text-[var(--color-pib-accent)] hover:underline"
              >
                Manage sequences
              </Link>
            </div>
            <div className="rounded-xl bg-white/[0.03] border border-[var(--color-pib-line)] divide-y divide-[var(--color-pib-line)]">
              {sequences.length === 0 ? (
                <p className="p-4 text-sm text-[var(--color-pib-text-muted)]">
                  No active sequences yet.
                </p>
              ) : (
                sequences.map((sequence) => (
                  <Link
                    key={sequence.id}
                    href={`/portal/email-analytics/sequences/${sequence.id}`}
                    className="flex items-center justify-between gap-4 p-4 text-sm transition-colors hover:bg-white/[0.04]"
                  >
                    <span className="font-medium text-[var(--color-pib-text)]">{sequence.name}</span>
                    <span className="text-xs text-[var(--color-pib-accent)]">Open analytics</span>
                  </Link>
                ))
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function PortalKpi({
  label,
  value,
  sub,
}: {
  label: string
  value: number | string
  sub?: string
}) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-[var(--color-pib-line)] p-4">
      <div className="text-xs text-[var(--color-pib-text-muted)]">{label}</div>
      <div className="text-2xl font-semibold">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {sub && <div className="text-xs text-[var(--color-pib-text-muted)] mt-1">{sub}</div>}
    </div>
  )
}
