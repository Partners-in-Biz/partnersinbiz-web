'use client'

// components/email-analytics/EmailAnalyticsDashboard.tsx
//
// The main client-side dashboard. Owns date range, tab state, and the four
// data fetches (overview, timeseries, contacts, leaderboard).

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { LineChart, BarChart, Donut, heatmapShade, heatmapTextColor } from './charts'
import { PageTabs } from '@/components/ui/AppFoundation'
import { scopedApiPath, scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import type {
  OrgEmailOverview,
  EngagementTimeseries,
  ContactEngagement,
  OrgComparisonRow,
  CohortAnalysis,
  SendTimeMatrix,
} from '@/lib/email-analytics/aggregate'
import type { RevenueOverview } from '@/lib/email-analytics/attribution'
import type { BenchmarkComparison, PerformanceBand } from '@/lib/email-analytics/benchmarks'

type TabKey =
  | 'overview'
  | 'engagement'
  | 'broadcasts'
  | 'sequences'
  | 'cohorts'
  | 'revenue'
  | 'send-time'
  | 'benchmarks'
  | 'leaderboard'

const TABS: Array<{ key: TabKey; label: string; adminOnly?: boolean }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'engagement', label: 'Engagement' },
  { key: 'broadcasts', label: 'Broadcasts' },
  { key: 'sequences', label: 'Sequences' },
  { key: 'cohorts', label: 'Cohorts' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'send-time', label: 'Send time' },
  { key: 'benchmarks', label: 'Benchmarks' },
  { key: 'leaderboard', label: 'Leaderboard', adminOnly: true },
]

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface SequenceSummary {
  id: string
  name: string
  status: string
}

type EmailAnalyticsSurface = 'admin' | 'portal'

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

export default function EmailAnalyticsDashboard({
  orgId,
  isAdmin,
  surface = 'admin',
  orgScope,
}: {
  orgId: string
  isAdmin: boolean
  surface?: EmailAnalyticsSurface
  orgScope?: PortalOrgRouteScope
}) {
  const today = useMemo(() => new Date(), [])
  const thirtyDaysAgo = useMemo(
    () => new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000),
    [today],
  )
  const [from, setFrom] = useState<string>(isoDate(thirtyDaysAgo))
  const [to, setTo] = useState<string>(isoDate(today))
  const [tab, setTab] = useState<TabKey>('overview')
  const routeScope = useMemo<PortalOrgRouteScope>(
    () => ({
      orgId: orgScope?.orgId ?? (surface === 'portal' ? orgId : undefined),
      orgSlug: orgScope?.orgSlug ?? undefined,
      sourceCompanyId: orgScope?.sourceCompanyId ?? undefined,
      sourceCompanyName: orgScope?.sourceCompanyName ?? undefined,
    }),
    [
      orgId,
      orgScope?.orgId,
      orgScope?.orgSlug,
      orgScope?.sourceCompanyId,
      orgScope?.sourceCompanyName,
      surface,
    ],
  )

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-semibold text-on-surface">Email Analytics</h1>
        <div className="flex items-center gap-2 text-sm">
          <label className="text-on-surface-variant">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="px-2 py-1 rounded-lg border border-outline-variant bg-surface text-on-surface"
          />
          <label className="text-on-surface-variant">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="px-2 py-1 rounded-lg border border-outline-variant bg-surface text-on-surface"
          />
        </div>
      </div>

      <PageTabs
        ariaLabel="Email analytics sections"
        value={tab}
        onValueChange={(value) => setTab(value as TabKey)}
        tabs={TABS.filter((item) => !item.adminOnly || isAdmin).map((item) => ({
          label: item.label,
          value: item.key,
        }))}
      />

      {tab === 'overview' && <OverviewTab orgId={orgId} from={from} to={to} />}
      {tab === 'engagement' && <EngagementTab orgId={orgId} />}
      {tab === 'broadcasts' && (
        <BroadcastsTab
          orgId={orgId}
          from={from}
          to={to}
          surface={surface}
          orgScope={routeScope}
        />
      )}
      {tab === 'sequences' && (
        <SequencesTab
          orgId={orgId}
          surface={surface}
          orgScope={routeScope}
        />
      )}
      {tab === 'cohorts' && <CohortsTab orgId={orgId} from={from} to={to} />}
      {tab === 'revenue' && <RevenueTab orgId={orgId} from={from} to={to} />}
      {tab === 'send-time' && <SendTimeTab orgId={orgId} from={from} to={to} />}
      {tab === 'benchmarks' && <BenchmarksTab orgId={orgId} from={from} to={to} />}
      {tab === 'leaderboard' && isAdmin && <LeaderboardTab from={from} to={to} />}
    </div>
  )
}

// ── Overview tab ────────────────────────────────────────────────────────────

function OverviewTab({ orgId, from, to }: { orgId: string; from: string; to: string }) {
  const [state, setState] = useState<{
    overview: OrgEmailOverview | null
    series: EngagementTimeseries | null
    loading: boolean
    key: string
  }>({ overview: null, series: null, loading: true, key: '' })

  useEffect(() => {
    const key = `${orgId}|${from}|${to}`
    const fromIso = new Date(from).toISOString()
    const toIso = new Date(`${to}T23:59:59.999Z`).toISOString()
    let cancelled = false
    Promise.all([
      fetch(`/api/v1/email-analytics/overview?orgId=${orgId}&from=${fromIso}&to=${toIso}`).then((r) => r.json()),
      fetch(`/api/v1/email-analytics/timeseries?orgId=${orgId}&from=${fromIso}&to=${toIso}&bucket=day`).then((r) => r.json()),
    ]).then(([o, s]) => {
      if (cancelled) return
      setState({ overview: o.data ?? null, series: s.data ?? null, loading: false, key })
    })
    return () => {
      cancelled = true
    }
  }, [orgId, from, to])

  const loading = state.loading || state.key !== `${orgId}|${from}|${to}`
  const overview = state.overview
  const series = state.series

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-surface-container animate-pulse" />
        ))}
      </div>
    )
  }

  if (!overview) {
    return <div className="text-on-surface-variant">No data.</div>
  }

  const { totals, rates, bySource, topBroadcasts, topCampaigns } = overview
  const sourceData = [
    { label: 'Broadcasts', value: bySource.broadcast.sent },
    { label: 'Campaigns', value: bySource.campaign.sent },
    { label: 'Sequences', value: bySource.sequence.sent },
    { label: 'One-off', value: bySource.oneOff.sent },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Sent" value={totals.sent} />
        <Kpi label="Delivered" value={totals.delivered} sub={pct(rates.deliveryRate)} />
        <Kpi label="Opened" value={totals.opened} sub={pct(rates.openRate) + ' open rate'} />
        <Kpi label="Clicked" value={totals.clicked} sub={pct(rates.clickRate) + ' CTR'} />
        <Kpi label="Bounced" value={totals.bounced} sub={pct(rates.bounceRate)} tone="warn" />
        <Kpi label="Unsubscribed" value={totals.unsubscribed} sub={pct(rates.unsubRate)} tone="warn" />
        <Kpi label="Failed" value={totals.failed} tone="warn" />
        <Kpi label="CTR on opens" value={pct(rates.ctrOnOpens)} />
      </div>

      <Section title="Engagement over time">
        {series && series.series.length > 0 ? (
          <LineChart
            series={[
              { name: 'Sent', points: series.series.map((s) => ({ x: s.date, y: s.sent })) },
              { name: 'Opened', points: series.series.map((s) => ({ x: s.date, y: s.opened })) },
              { name: 'Clicked', points: series.series.map((s) => ({ x: s.date, y: s.clicked })) },
            ]}
          />
        ) : (
          <Empty>No emails sent in this window.</Empty>
        )}
      </Section>

      <div className="grid md:grid-cols-2 gap-6">
        <Section title="By source">
          <Donut data={sourceData.filter((d) => d.value > 0)} />
        </Section>
        <Section title="Top broadcasts">
          {topBroadcasts.length === 0 ? (
            <Empty>No broadcasts in range.</Empty>
          ) : (
            <BarChart data={topBroadcasts.map((b) => ({ label: b.name, value: b.sent }))} />
          )}
        </Section>
      </div>

      <Section title="Top campaigns">
        {topCampaigns.length === 0 ? (
          <Empty>No campaigns in range.</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-on-surface-variant text-left">
              <tr>
                <th className="py-2">Name</th>
                <th className="py-2 text-right">Sent</th>
                <th className="py-2 text-right">Open rate</th>
                <th className="py-2 text-right">Click rate</th>
              </tr>
            </thead>
            <tbody>
              {topCampaigns.map((c) => (
                <tr key={c.id} className="border-t border-outline-variant">
                  <td className="py-2 text-on-surface">{c.name}</td>
                  <td className="py-2 text-right tabular-nums">{c.sent}</td>
                  <td className="py-2 text-right tabular-nums">{pct(c.openRate)}</td>
                  <td className="py-2 text-right tabular-nums">{pct(c.clickRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  )
}

// ── Engagement tab ──────────────────────────────────────────────────────────

const ENGAGEMENT_STATUSES: ContactEngagement['status'][] = [
  'highly-engaged',
  'engaged',
  'cooling',
  'dormant',
  'unsubscribed',
  'bounced',
]

function EngagementTab({ orgId }: { orgId: string }) {
  const [status, setStatus] = useState<ContactEngagement['status'] | 'all'>('all')
  const [state, setState] = useState<{ rows: ContactEngagement[]; loading: boolean; key: string }>(
    { rows: [], loading: true, key: '' },
  )

  useEffect(() => {
    const key = `${orgId}|${status}`
    const q = status === 'all' ? '' : `&status=${status}`
    let cancelled = false
    fetch(`/api/v1/email-analytics/contacts?orgId=${orgId}&limit=200${q}`)
      .then((r) => r.json())
      .then((b) => {
        if (cancelled) return
        setState({ rows: b.data ?? [], loading: false, key })
      })
    return () => {
      cancelled = true
    }
  }, [orgId, status])

  const loading = state.loading || state.key !== `${orgId}|${status}`
  const rows = state.rows

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setStatus('all')}
          className={`px-3 py-1 rounded-full text-xs ${
            status === 'all' ? 'bg-amber-500 text-black' : 'bg-surface-container text-on-surface-variant'
          }`}
        >
          All
        </button>
        {ENGAGEMENT_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`px-3 py-1 rounded-full text-xs ${
              status === s ? 'bg-amber-500 text-black' : 'bg-surface-container text-on-surface-variant'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="h-64 rounded-xl bg-surface-container animate-pulse" />
      ) : rows.length === 0 ? (
        <Empty>No contacts match this filter.</Empty>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-on-surface-variant text-left">
            <tr>
              <th className="py-2">Contact</th>
              <th className="py-2 text-right">Score</th>
              <th className="py-2 text-right">Sent</th>
              <th className="py-2 text-right">Opened</th>
              <th className="py-2 text-right">Clicked</th>
              <th className="py-2">Status</th>
              <th className="py-2">Last engaged</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.contactId} className="border-t border-outline-variant">
                <td className="py-2">
                  <div className="text-on-surface">{r.name || r.email}</div>
                  <div className="text-xs text-on-surface-variant">{r.email}</div>
                </td>
                <td className="py-2 text-right tabular-nums">{r.score}</td>
                <td className="py-2 text-right tabular-nums">{r.sent}</td>
                <td className="py-2 text-right tabular-nums">{r.opened}</td>
                <td className="py-2 text-right tabular-nums">{r.clicked}</td>
                <td className="py-2">
                  <span className="px-2 py-0.5 rounded-full text-xs bg-surface-container text-on-surface-variant">
                    {r.status}
                  </span>
                </td>
                <td className="py-2 text-on-surface-variant text-xs">
                  {r.lastEngagedAt ? new Date(r.lastEngagedAt).toLocaleDateString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── Broadcasts tab ──────────────────────────────────────────────────────────

function broadcastAnalyticsHref(
  broadcastId: string,
  surface: EmailAnalyticsSurface,
  orgScope: PortalOrgRouteScope,
): string {
  if (surface === 'portal') {
    return scopedPortalPath(`/portal/email-analytics/broadcasts/${broadcastId}`, orgScope)
  }
  return `/portal/email-analytics/broadcasts/${broadcastId}`
}

function BroadcastsTab({
  orgId,
  from,
  to,
  surface,
  orgScope,
}: {
  orgId: string
  from: string
  to: string
  surface: EmailAnalyticsSurface
  orgScope: PortalOrgRouteScope
}) {
  const [state, setState] = useState<{ overview: OrgEmailOverview | null; loading: boolean; key: string }>(
    { overview: null, loading: true, key: '' },
  )

  useEffect(() => {
    const key = `${orgId}|${from}|${to}`
    const fromIso = new Date(from).toISOString()
    const toIso = new Date(`${to}T23:59:59.999Z`).toISOString()
    let cancelled = false
    fetch(`/api/v1/email-analytics/overview?orgId=${orgId}&from=${fromIso}&to=${toIso}`)
      .then((r) => r.json())
      .then((b) => {
        if (cancelled) return
        setState({ overview: b.data ?? null, loading: false, key })
      })
    return () => {
      cancelled = true
    }
  }, [orgId, from, to])

  const loading = state.loading || state.key !== `${orgId}|${from}|${to}`
  const overview = state.overview

  if (loading) return <div className="h-64 rounded-xl bg-surface-container animate-pulse" />
  if (!overview || overview.topBroadcasts.length === 0) {
    return <Empty>No broadcasts in this window.</Empty>
  }

  return (
    <table className="w-full text-sm">
      <thead className="text-on-surface-variant text-left">
        <tr>
          <th className="py-2">Name</th>
          <th className="py-2 text-right">Sent</th>
          <th className="py-2 text-right">Opened</th>
          <th className="py-2 text-right">Clicked</th>
          <th className="py-2 text-right">Open rate</th>
          <th className="py-2 text-right">Click rate</th>
          <th className="py-2"></th>
        </tr>
      </thead>
      <tbody>
        {overview.topBroadcasts.map((b) => (
          <tr key={b.id} className="border-t border-outline-variant">
            <td className="py-2 text-on-surface">{b.name}</td>
            <td className="py-2 text-right tabular-nums">{b.sent}</td>
            <td className="py-2 text-right tabular-nums">{b.opened}</td>
            <td className="py-2 text-right tabular-nums">{b.clicked}</td>
            <td className="py-2 text-right tabular-nums">{pct(b.openRate)}</td>
            <td className="py-2 text-right tabular-nums">{pct(b.clickRate)}</td>
            <td className="py-2 text-right">
              <Link
                href={broadcastAnalyticsHref(b.id, surface, orgScope)}
                aria-label={`Open analytics for ${b.name}`}
                className="text-amber-500 hover:underline text-xs"
              >
                Details →
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Sequences tab ───────────────────────────────────────────────────────────

function sequenceAnalyticsHref(
  sequenceId: string,
  surface: EmailAnalyticsSurface,
  orgScope: PortalOrgRouteScope,
): string {
  if (surface === 'portal') {
    return scopedPortalPath(`/portal/email-analytics/sequences/${sequenceId}`, orgScope)
  }
  return `/portal/email-analytics/sequences/${sequenceId}`
}

function sequenceManagementHref(surface: EmailAnalyticsSurface, orgScope: PortalOrgRouteScope): string {
  if (surface === 'portal') {
    return scopedPortalPath('/portal/settings/sequences', orgScope)
  }
  return '/portal/sequences'
}

function SequencesTab({
  orgId,
  surface,
  orgScope,
}: {
  orgId: string
  surface: EmailAnalyticsSurface
  orgScope: PortalOrgRouteScope
}) {
  const [state, setState] = useState<{
    sequences: SequenceSummary[]
    loading: boolean
    error: string
    key: string
  }>({ sequences: [], loading: true, error: '', key: '' })

  useEffect(() => {
    const key = orgId
    let cancelled = false
    fetch(scopedApiPath('/api/v1/crm/sequences', { orgId }))
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return
        const rawSequences = body.data?.sequences ?? body.data ?? []
        const sequences = Array.isArray(rawSequences)
          ? rawSequences.filter((item): item is SequenceSummary => (
            item &&
            typeof item.id === 'string' &&
            typeof item.name === 'string' &&
            item.status === 'active'
          ))
          : []
        setState({ sequences, loading: false, error: body.error ?? '', key })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setState({
          sequences: [],
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load sequences.',
          key,
        })
      })
    return () => {
      cancelled = true
    }
  }, [orgId])

  const loading = state.loading || state.key !== orgId
  const sequences = state.sequences

  if (loading) return <div className="h-64 rounded-xl bg-surface-container animate-pulse" />

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-on-surface-variant">Sequence performance</h2>
        <Link
          href={sequenceManagementHref(surface, orgScope)}
          className="text-xs font-medium text-amber-500 hover:underline"
        >
          Manage sequences
        </Link>
      </div>
      <div className="rounded-xl bg-surface-container border border-outline-variant divide-y divide-outline-variant">
        {state.error ? (
          <p className="p-4 text-sm text-on-surface-variant">{state.error}</p>
        ) : sequences.length === 0 ? (
          <p className="p-4 text-sm text-on-surface-variant">No active sequences yet.</p>
        ) : (
          sequences.map((sequence) => (
            <Link
              key={sequence.id}
              href={sequenceAnalyticsHref(sequence.id, surface, orgScope)}
              className="flex items-center justify-between gap-4 p-4 text-sm transition-colors hover:bg-white/[0.04]"
            >
              <span className="font-medium text-on-surface">{sequence.name}</span>
              <span className="text-xs text-amber-500">Open analytics</span>
            </Link>
          ))
        )}
      </div>
    </section>
  )
}

// ── Leaderboard tab ─────────────────────────────────────────────────────────

function LeaderboardTab({ from, to }: { from: string; to: string }) {
  const [state, setState] = useState<{ rows: OrgComparisonRow[]; loading: boolean; key: string }>(
    { rows: [], loading: true, key: '' },
  )

  useEffect(() => {
    const key = `${from}|${to}`
    const fromIso = new Date(from).toISOString()
    const toIso = new Date(`${to}T23:59:59.999Z`).toISOString()
    let cancelled = false
    fetch(`/api/v1/email-analytics/leaderboard?from=${fromIso}&to=${toIso}`)
      .then((r) => r.json())
      .then((b) => {
        if (cancelled) return
        setState({ rows: b.data ?? [], loading: false, key })
      })
    return () => {
      cancelled = true
    }
  }, [from, to])

  const loading = state.loading || state.key !== `${from}|${to}`
  const rows = state.rows

  if (loading) return <div className="h-64 rounded-xl bg-surface-container animate-pulse" />
  if (rows.length === 0) return <Empty>No org activity in this window.</Empty>

  return (
    <table className="w-full text-sm">
      <thead className="text-on-surface-variant text-left">
        <tr>
          <th className="py-2">Org</th>
          <th className="py-2 text-right">Sent</th>
          <th className="py-2 text-right">Open rate</th>
          <th className="py-2 text-right">Click rate</th>
          <th className="py-2 text-right">Bounce rate</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.orgId} className="border-t border-outline-variant">
            <td className="py-2 text-on-surface">{r.orgName}</td>
            <td className="py-2 text-right tabular-nums">{r.sent}</td>
            <td className="py-2 text-right tabular-nums">{pct(r.openRate)}</td>
            <td className="py-2 text-right tabular-nums">{pct(r.clickRate)}</td>
            <td className="py-2 text-right tabular-nums">{pct(r.bounceRate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Cohorts tab ─────────────────────────────────────────────────────────────

function CohortsTab({ orgId, from, to }: { orgId: string; from: string; to: string }) {
  const [state, setState] = useState<{ data: CohortAnalysis | null; loading: boolean; key: string }>(
    { data: null, loading: true, key: '' },
  )

  useEffect(() => {
    const key = `${orgId}|${from}|${to}`
    const fromIso = new Date(from).toISOString()
    const toIso = new Date(`${to}T23:59:59.999Z`).toISOString()
    let cancelled = false
    fetch(
      `/api/v1/email-analytics/cohort?orgId=${orgId}&from=${fromIso}&to=${toIso}&weeksToShow=12`,
    )
      .then((r) => r.json())
      .then((b) => {
        if (cancelled) return
        setState({ data: b.data ?? null, loading: false, key })
      })
    return () => {
      cancelled = true
    }
  }, [orgId, from, to])

  const loading = state.loading || state.key !== `${orgId}|${from}|${to}`
  const data = state.data

  if (loading) return <div className="h-64 rounded-xl bg-surface-container animate-pulse" />
  if (!data || data.cohorts.length === 0) {
    return (
      <Empty>
        No cohort data — once contacts sign up in this window we can chart their week-over-week
        engagement here.
      </Empty>
    )
  }

  const weeksToShow = data.weeksToShow
  const headers: number[] = []
  for (let i = 0; i < weeksToShow; i++) headers.push(i)

  return (
    <div className="space-y-3">
      <p className="text-xs text-on-surface-variant">
        Rows = ISO-week each cohort signed up (UTC Monday). Cells = % of cohort that opened or
        clicked an email that week.
      </p>
      <div className="overflow-x-auto rounded-xl bg-surface-container">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="text-left p-2 text-on-surface-variant font-medium sticky left-0 bg-surface-container z-10">
                Signup week
              </th>
              <th className="text-right p-2 text-on-surface-variant font-medium">Size</th>
              {headers.map((i) => (
                <th key={i} className="p-2 text-on-surface-variant font-medium text-center">
                  W{i}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.cohorts.map((c) => (
              <tr key={c.cohortStart}>
                <td className="p-2 text-on-surface text-xs whitespace-nowrap sticky left-0 bg-surface-container z-10">
                  {c.cohortStart}
                </td>
                <td className="p-2 text-on-surface-variant tabular-nums text-right">
                  {c.cohortSize}
                </td>
                {headers.map((i) => {
                  const ret = c.retentionPercent[i]
                  if (typeof ret !== 'number') {
                    return <td key={i} className="p-2 text-on-surface-variant text-center">—</td>
                  }
                  const bg = heatmapShade(ret)
                  const fg = heatmapTextColor(ret)
                  return (
                    <td
                      key={i}
                      className="p-2 text-center tabular-nums border border-outline-variant/30"
                      style={{ background: bg, color: fg }}
                      title={`Week ${i}: ${pct(ret)}`}
                    >
                      {pct(ret)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Revenue tab ─────────────────────────────────────────────────────────────

function zar(amount: number): string {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0,
  }).format(amount)
}

function RevenueTab({ orgId, from, to }: { orgId: string; from: string; to: string }) {
  const [state, setState] = useState<{ data: RevenueOverview | null; loading: boolean; key: string }>(
    { data: null, loading: true, key: '' },
  )

  useEffect(() => {
    const key = `${orgId}|${from}|${to}`
    const fromIso = new Date(from).toISOString()
    const toIso = new Date(`${to}T23:59:59.999Z`).toISOString()
    let cancelled = false
    fetch(`/api/v1/email-analytics/revenue?orgId=${orgId}&from=${fromIso}&to=${toIso}`)
      .then((r) => r.json())
      .then((b) => {
        if (cancelled) return
        setState({ data: b.data ?? null, loading: false, key })
      })
    return () => {
      cancelled = true
    }
  }, [orgId, from, to])

  const loading = state.loading || state.key !== `${orgId}|${from}|${to}`
  const data = state.data

  if (loading) return <div className="h-64 rounded-xl bg-surface-container animate-pulse" />
  if (!data || (data.totalRevenue === 0 && data.totalConversions === 0)) {
    return (
      <Empty>
        No attributed revenue yet. Revenue shows up here once a deal or invoice closes within 30
        days of a contact clicking an email.
      </Empty>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Total revenue" value={zar(data.totalRevenue)} />
        <Kpi label="Conversions" value={data.totalConversions} />
        <Kpi
          label="Avg deal size"
          value={
            data.totalConversions > 0
              ? zar(Math.round(data.totalRevenue / data.totalConversions))
              : zar(0)
          }
        />
      </div>

      <Section title="Revenue by day">
        {data.revenueByDay.length === 0 ? (
          <Empty>No daily breakdown.</Empty>
        ) : (
          <LineChart
            series={[
              {
                name: 'Revenue',
                points: data.revenueByDay.map((d) => ({ x: d.date, y: d.revenue })),
              },
              {
                name: 'Conversions',
                points: data.revenueByDay.map((d) => ({ x: d.date, y: d.conversions })),
              },
            ]}
          />
        )}
      </Section>

      <div className="grid md:grid-cols-2 gap-6">
        <Section title="Top performing emails">
          {data.topPerformingEmails.length === 0 ? (
            <Empty>No attributed emails.</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-on-surface-variant text-left">
                <tr>
                  <th className="py-2">Subject</th>
                  <th className="py-2 text-right">Conversions</th>
                  <th className="py-2 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.topPerformingEmails.map((e) => (
                  <tr key={e.emailId} className="border-t border-outline-variant">
                    <td className="py-2 text-on-surface truncate max-w-xs">
                      {e.subject || <span className="text-on-surface-variant italic">No subject</span>}
                    </td>
                    <td className="py-2 text-right tabular-nums">{e.conversions}</td>
                    <td className="py-2 text-right tabular-nums">{zar(e.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Top performing sources">
          {data.topPerformingSources.length === 0 ? (
            <Empty>No attributed sources.</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-on-surface-variant text-left">
                <tr>
                  <th className="py-2">Source</th>
                  <th className="py-2">Name</th>
                  <th className="py-2 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.topPerformingSources.map((s) => (
                  <tr key={`${s.source}|${s.sourceId}`} className="border-t border-outline-variant">
                    <td className="py-2 text-on-surface-variant text-xs">{s.source}</td>
                    <td className="py-2 text-on-surface truncate max-w-xs">{s.name}</td>
                    <td className="py-2 text-right tabular-nums">{zar(s.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>
    </div>
  )
}

// ── Send-time tab ───────────────────────────────────────────────────────────

function SendTimeTab({ orgId, from, to }: { orgId: string; from: string; to: string }) {
  const [state, setState] = useState<{ data: SendTimeMatrix | null; loading: boolean; key: string }>(
    { data: null, loading: true, key: '' },
  )

  useEffect(() => {
    const key = `${orgId}|${from}|${to}`
    const fromIso = new Date(from).toISOString()
    const toIso = new Date(`${to}T23:59:59.999Z`).toISOString()
    let cancelled = false
    fetch(`/api/v1/email-analytics/send-time-matrix?orgId=${orgId}&from=${fromIso}&to=${toIso}`)
      .then((r) => r.json())
      .then((b) => {
        if (cancelled) return
        setState({ data: b.data ?? null, loading: false, key })
      })
    return () => {
      cancelled = true
    }
  }, [orgId, from, to])

  const loading = state.loading || state.key !== `${orgId}|${from}|${to}`
  const data = state.data

  if (loading) return <div className="h-64 rounded-xl bg-surface-container animate-pulse" />
  if (!data || data.totalSamples === 0) {
    return <Empty>No send activity in this window — nothing to plot.</Empty>
  }

  // Compute max openRate to normalise the heatmap, and find best cell stats.
  let maxOpenRate = 0
  for (const row of data.cells) {
    for (const cell of row) {
      if (cell.openRate > maxOpenRate) maxOpenRate = cell.openRate
    }
  }
  const bestCell = data.cells[data.bestDay]?.[data.bestHour]

  return (
    <div className="space-y-3">
      <p className="text-xs text-on-surface-variant">
        Open rates by day-of-week and hour, in the org&apos;s timezone ({data.timezone}). Cells
        need at least 10 sends to be eligible for best/worst.
      </p>
      <div className="overflow-x-auto rounded-xl bg-surface-container">
        <table className="text-[10px] border-separate border-spacing-0 mx-auto">
          <thead>
            <tr>
              <th className="p-1.5 text-on-surface-variant font-medium"></th>
              {Array.from({ length: 24 }).map((_, h) => (
                <th
                  key={h}
                  className="p-1 text-on-surface-variant font-medium text-center w-9"
                >
                  {String(h).padStart(2, '0')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.cells.map((row, d) => (
              <tr key={d}>
                <td className="p-1.5 text-on-surface-variant text-right font-medium pr-2">
                  {DAY_LABELS[d]}
                </td>
                {row.map((cell, h) => {
                  const norm = maxOpenRate > 0 ? cell.openRate / maxOpenRate : 0
                  const bg = heatmapShade(norm)
                  const fg = heatmapTextColor(norm)
                  const isBest = d === data.bestDay && h === data.bestHour
                  const isWorst = d === data.worstDay && h === data.worstHour
                  return (
                    <td
                      key={h}
                      className={`p-0 text-center tabular-nums border ${
                        isBest
                          ? 'border-amber-300 border-2'
                          : isWorst
                            ? 'border-red-500 border-2'
                            : 'border-outline-variant/30'
                      }`}
                      style={{ background: bg, color: fg, minWidth: 28 }}
                      title={`${DAY_LABELS[d]} ${String(h).padStart(2, '0')}:00 — ${pct(
                        cell.openRate,
                      )} open rate · ${cell.sent} sent`}
                    >
                      <div className="px-1 py-1 leading-tight">
                        {cell.sent > 0 ? `${Math.round(cell.openRate * 100)}` : ''}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {bestCell && bestCell.sent >= 1 ? (
        <div className="rounded-xl bg-surface-container p-4 text-sm text-on-surface">
          Best send time:{' '}
          <span className="font-semibold text-amber-400">
            {DAY_LABELS[data.bestDay]} at {String(data.bestHour).padStart(2, '0')}:00
          </span>{' '}
          — {pct(bestCell.openRate)} avg open rate ({bestCell.sent} sends)
        </div>
      ) : (
        <Empty>Not enough data yet to pick a best slot — keep sending.</Empty>
      )}
    </div>
  )
}

// ── Benchmarks tab ──────────────────────────────────────────────────────────

const INDUSTRIES = [
  'newsletter',
  'ecommerce',
  'saas',
  'agency',
  'nonprofit',
  'b2b',
  'media',
  'finance',
  'health',
] as const

function bandArrow(orgValue: number, ownValue: number): string {
  if (orgValue > ownValue + 0.0001) return '↑'
  if (orgValue < ownValue - 0.0001) return '↓'
  return '→'
}

function bandColor(band: PerformanceBand, direction: 'higher' | 'lower'): string {
  // For "higher is better" (open/click): above-p75 green, below-p25 red.
  // For "lower is better" (bounce/unsub): above-p75 red, below-p25 green.
  if (direction === 'higher') {
    if (band === 'above-p75') return 'text-emerald-400'
    if (band === 'p50-p75') return 'text-amber-300'
    if (band === 'p25-p50') return 'text-amber-500'
    return 'text-red-400'
  }
  if (band === 'above-p75') return 'text-red-400'
  if (band === 'p50-p75') return 'text-amber-500'
  if (band === 'p25-p50') return 'text-amber-300'
  return 'text-emerald-400'
}

function bandLabel(band: PerformanceBand): string {
  switch (band) {
    case 'above-p75':
      return '> p75'
    case 'p50-p75':
      return 'p50–p75'
    case 'p25-p50':
      return 'p25–p50'
    case 'below-p25':
      return '< p25'
  }
}

function BenchmarksTab({ orgId, from, to }: { orgId: string; from: string; to: string }) {
  const [industry, setIndustry] = useState<string>('')
  const [state, setState] = useState<{
    data: BenchmarkComparison | null
    loading: boolean
    key: string
  }>({ data: null, loading: true, key: '' })

  useEffect(() => {
    const key = `${orgId}|${from}|${to}|${industry}`
    const fromIso = new Date(from).toISOString()
    const toIso = new Date(`${to}T23:59:59.999Z`).toISOString()
    const industryQ = industry ? `&industry=${industry}` : ''
    let cancelled = false
    fetch(
      `/api/v1/email-analytics/benchmarks?orgId=${orgId}&from=${fromIso}&to=${toIso}${industryQ}`,
    )
      .then((r) => r.json())
      .then((b) => {
        if (cancelled) return
        setState({ data: b.data ?? null, loading: false, key })
      })
    return () => {
      cancelled = true
    }
  }, [orgId, from, to, industry])

  const loading = state.loading || state.key !== `${orgId}|${from}|${to}|${industry}`
  const data = state.data

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <label className="text-on-surface-variant">Industry</label>
        <select
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
          className="px-2 py-1 rounded-lg border border-outline-variant bg-surface text-on-surface"
        >
          <option value="">Auto (org default)</option>
          {INDUSTRIES.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="h-64 rounded-xl bg-surface-container animate-pulse" />
      ) : !data ? (
        <Empty>Could not load benchmarks.</Empty>
      ) : (
        <BenchmarksTable data={data} />
      )}
    </div>
  )
}

function BenchmarksTable({ data }: { data: BenchmarkComparison }) {
  const rows: Array<{
    key: keyof BenchmarkComparison['orgRates']
    label: string
    direction: 'higher' | 'lower'
  }> = [
    { key: 'openRate', label: 'Open rate', direction: 'higher' },
    { key: 'clickRate', label: 'Click rate', direction: 'higher' },
    { key: 'bounceRate', label: 'Bounce rate', direction: 'lower' },
    { key: 'unsubRate', label: 'Unsubscribe rate', direction: 'lower' },
  ]

  return (
    <div className="rounded-xl bg-surface-container overflow-hidden">
      <table className="w-full text-sm">
        <thead className="text-on-surface-variant text-left">
          <tr className="border-b border-outline-variant">
            <th className="py-2 px-3">Metric</th>
            <th className="py-2 px-3 text-right">This window</th>
            <th className="py-2 px-3 text-right">Your rolling 30d</th>
            <th className="py-2 px-3 text-right">Industry p50</th>
            <th className="py-2 px-3 text-right">Industry p25 / p75</th>
            <th className="py-2 px-3">Band</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const orgValue = data.orgRates[row.key]
            const ownValue = data.ownRolling30Day[row.key]
            const benchKey = row.key as keyof Pick<
              BenchmarkComparison['industry'],
              'openRate' | 'clickRate' | 'bounceRate' | 'unsubRate'
            >
            const band = data.industry[benchKey]
            const perfBand = data.performance[row.key]
            const arrow = bandArrow(orgValue, ownValue)
            const arrowColor =
              row.direction === 'higher'
                ? arrow === '↑'
                  ? 'text-emerald-400'
                  : arrow === '↓'
                    ? 'text-red-400'
                    : 'text-on-surface-variant'
                : arrow === '↓'
                  ? 'text-emerald-400'
                  : arrow === '↑'
                    ? 'text-red-400'
                    : 'text-on-surface-variant'
            return (
              <tr key={row.key} className="border-t border-outline-variant">
                <td className="py-2 px-3 text-on-surface">{row.label}</td>
                <td className="py-2 px-3 text-right tabular-nums text-on-surface">
                  <span className="inline-flex items-baseline gap-1.5">
                    <span>{pct(orgValue)}</span>
                    <span className={arrowColor + ' text-xs'}>{arrow}</span>
                  </span>
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-on-surface-variant">
                  {pct(ownValue)}
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-on-surface-variant">
                  {pct(band.p50)}
                </td>
                <td className="py-2 px-3 text-right text-xs text-on-surface-variant tabular-nums">
                  <span className="px-1.5 py-0.5 rounded bg-surface-container-high mr-1">
                    p25 {pct(band.p25)}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-surface-container-high">
                    p75 {pct(band.p75)}
                  </span>
                </td>
                <td className={`py-2 px-3 ${bandColor(perfBand, row.direction)} text-xs font-medium`}>
                  {bandLabel(perfBand)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="px-3 py-2 text-xs text-on-surface-variant border-t border-outline-variant">
        Industry: <span className="text-on-surface">{data.industry.industry}</span>.
        Arrow compares &ldquo;This window&rdquo; to &ldquo;Your rolling 30d&rdquo;.
      </div>
    </div>
  )
}

// ── Atoms ───────────────────────────────────────────────────────────────────

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: number | string
  sub?: string
  tone?: 'warn'
}) {
  return (
    <div className="rounded-xl bg-surface-container p-4">
      <div className="text-xs text-on-surface-variant">{label}</div>
      <div className={`text-2xl font-semibold ${tone === 'warn' ? 'text-red-400' : 'text-on-surface'}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {sub && <div className="text-xs text-on-surface-variant mt-1">{sub}</div>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-medium text-on-surface-variant mb-2">{title}</h2>
      <div className="rounded-xl bg-surface-container p-4">{children}</div>
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-on-surface-variant text-sm">{children}</div>
}
