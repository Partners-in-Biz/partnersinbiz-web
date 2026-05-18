'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'

// ── API response types ─────────────────────────────────────────────────────────

interface FunnelData {
  byType: {
    lead: number
    prospect: number
    client: number
    churned: number
    other: number
  }
  byStage: Record<string, number>
  total: number
}

interface ForecastPeriod {
  dealCount: number
  totalValue: number
  weightedValue: number
}

interface ForecastData {
  periods: {
    thisMonth: ForecastPeriod
    nextMonth: ForecastPeriod
    thisQuarter: ForecastPeriod
    nextQuarter: ForecastPeriod
    beyond: ForecastPeriod
    noDate: ForecastPeriod
  }
  summary: {
    totalOpenDeals: number
    totalValue: number
    weightedValue: number
  }
}

interface ActivityData {
  byType: Record<string, number>
  total: number
  perDay: { date: string; count: number }[]
  since: string
  days: number
}

interface PipelineVelocityStage {
  pipelineId: string
  stageId: string
  dealCount: number
  avgDays: number
  maxDays: number
  bottleneck: boolean
}

interface PipelineVelocityData {
  stages: PipelineVelocityStage[]
  summary: {
    stageCount: number
    bottleneckCount: number
    slowestStage: PipelineVelocityStage | null
  }
}

interface RepPerformanceRow {
  uid: string
  displayName: string
  openDeals: number
  wonDeals: number
  lostDeals: number
  openValue: number
  wonValue: number
  activities: number
  winRate: number | null
}

interface RepPerformanceData {
  reps: RepPerformanceRow[]
  summary: {
    repCount: number
    totalWonValue: number
    totalOpenValue: number
    totalActivities: number
  }
}

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmtZar(value: number): string {
  return `R ${value.toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function fmtNum(value: number): string {
  return value.toLocaleString('en-ZA', { maximumFractionDigits: 0 })
}

// ── Skeleton ───────────────────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

// ── Horizontal bar chart (pure CSS) ───────────────────────────────────────────

function HBarChart({ entries }: { entries: [string, number][] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-[var(--color-pib-text-muted)]">No data yet.</p>
  }
  const maxCount = Math.max(...entries.map(([, n]) => n), 1)
  return (
    <div className="space-y-2">
      {entries.map(([label, count]) => (
        <div key={label} className="flex items-center gap-3">
          <span className="text-xs w-24 shrink-0 capitalize text-right text-[var(--color-pib-text-muted)] truncate" title={label}>
            {label}
          </span>
          <div className="flex-1 h-2 rounded-full bg-[var(--color-pib-line-strong)] overflow-hidden">
            <div
              className="h-full rounded-full bg-[var(--color-pib-accent)] transition-all duration-500"
              style={{ width: `${(count / maxCount) * 100}%` }}
            />
          </div>
          <span className="text-xs w-8 text-right font-mono text-[var(--color-pib-text)]">{count}</span>
        </div>
      ))}
    </div>
  )
}

// ── Stat card (consistent with dashboard Tile) ─────────────────────────────────

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon?: string }) {
  return (
    <div className="pib-stat-card">
      <div className="flex items-start justify-between">
        <p className="eyebrow !text-[10px]">{label}</p>
        {icon && <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">{icon}</span>}
      </div>
      <p className="mt-3 font-display tracking-tight leading-none text-3xl md:text-4xl text-[var(--color-pib-text)]">
        {value}
      </p>
      {sub && <p className="mt-3 text-xs text-[var(--color-pib-text-muted)]">{sub}</p>}
    </div>
  )
}

// ── Summary chip (inline metric) ──────────────────────────────────────────────

function SummaryChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="bento-card !p-4 min-w-[130px]">
      <p className="eyebrow !text-[10px] mb-1">{label}</p>
      <p className="text-xl font-display font-bold text-[var(--color-pib-text)] leading-none">{value}</p>
    </div>
  )
}

// ── Section wrapper ────────────────────────────────────────────────────────────

function Section({ eyebrow, children }: { eyebrow: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-5">
      <p className="eyebrow">{eyebrow}</p>
      {children}
    </section>
  )
}

// ── Forecast table row ────────────────────────────────────────────────────────

interface ForecastRowProps {
  label: string
  period: ForecastPeriod
}

function ForecastRow({ label, period }: ForecastRowProps) {
  const muted = period.dealCount === 0
  const cls = muted ? 'text-[var(--color-pib-text-muted)]' : 'text-[var(--color-pib-text)]'
  return (
    <tr className={`border-b border-[var(--color-pib-line)] last:border-0 ${muted ? 'opacity-50' : ''}`}>
      <td className={`px-4 py-3 text-sm font-medium ${cls}`}>{label}</td>
      <td className={`px-4 py-3 text-sm text-right font-mono ${cls}`}>{fmtNum(period.dealCount)}</td>
      <td className={`px-4 py-3 text-sm text-right font-mono ${cls}`}>{period.dealCount > 0 ? fmtZar(period.totalValue) : '—'}</td>
      <td className={`px-4 py-3 text-sm text-right font-mono ${muted ? 'text-[var(--color-pib-text-muted)]' : 'text-[var(--color-pib-accent)]'}`}>
        {period.dealCount > 0 ? fmtZar(period.weightedValue) : '—'}
      </td>
    </tr>
  )
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ perDay }: { perDay: ActivityData['perDay'] }) {
  if (perDay.length === 0) return null
  const maxCount = Math.max(...perDay.map((d) => d.count), 1)
  return (
    <div className="flex items-end gap-0.5 h-12">
      {perDay.map(({ date, count }) => (
        <div
          key={date}
          title={`${date}: ${count}`}
          className="flex-1 bg-[var(--color-pib-accent)] rounded-sm opacity-80 min-w-[2px]"
          style={{ height: `${(count / maxCount) * 100}%` }}
        />
      ))}
    </div>
  )
}

// ── Days selector ─────────────────────────────────────────────────────────────

const DAY_OPTIONS = [30, 60, 90] as const
type DaysOption = (typeof DAY_OPTIONS)[number]

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CrmReportsPage() {
  const [funnel, setFunnel] = useState<FunnelData | null>(null)
  const [forecast, setForecast] = useState<ForecastData | null>(null)
  const [activity, setActivity] = useState<ActivityData | null>(null)
  const [velocity, setVelocity] = useState<PipelineVelocityData | null>(null)
  const [repPerformance, setRepPerformance] = useState<RepPerformanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activityLoading, setActivityLoading] = useState(false)
  const [days, setDays] = useState<DaysOption>(30)

  // Initial fetch — all reports in parallel
  useEffect(() => {
    Promise.all([
      fetch('/api/v1/crm/reports/funnel').then((r) => r.json()),
      fetch('/api/v1/crm/reports/forecast').then((r) => r.json()),
      fetch('/api/v1/crm/reports/pipeline-velocity').then((r) => r.json()),
      fetch('/api/v1/crm/reports/rep-performance').then((r) => r.json()),
      fetch(`/api/v1/crm/reports/activity-summary?days=30`).then((r) => r.json()),
    ])
      .then(([funnelBody, forecastBody, velocityBody, repBody, activityBody]) => {
        setFunnel(funnelBody.data ?? funnelBody)
        setForecast(forecastBody.data ?? forecastBody)
        setVelocity(velocityBody.data ?? velocityBody)
        setRepPerformance(repBody.data ?? repBody)
        setActivity(activityBody.data ?? activityBody)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Refetch activity when days selector changes (after initial load)
  const fetchActivity = useCallback(
    (d: DaysOption) => {
      setActivityLoading(true)
      fetch(`/api/v1/crm/reports/activity-summary?days=${d}`)
        .then((r) => r.json())
        .then((b) => setActivity(b.data ?? b))
        .catch(() => {})
        .finally(() => setActivityLoading(false))
    },
    [],
  )

  function handleDaysChange(d: DaysOption) {
    if (d === days) return
    setDays(d)
    fetchActivity(d)
  }

  // ── Funnel derived values ────────────────────────────────────────────────────

  const byStageEntries: [string, number][] = funnel
    ? Object.entries(funnel.byStage).sort((a, b) => b[1] - a[1])
    : []

  // ── Activity derived values ──────────────────────────────────────────────────

  const byTypeEntries: [string, number][] = activity
    ? Object.entries(activity.byType).sort((a, b) => b[1] - a[1])
    : []

  // ── Loading state ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-12">
        <header>
          <p className="eyebrow">CRM</p>
          <h1 className="pib-page-title mt-2">CRM Reports</h1>
        </header>
        {/* Funnel skeleton */}
        <div className="space-y-5">
          <div className="pib-skeleton h-4 w-36" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
          </div>
          <Skeleton className="h-40" />
        </div>
        {/* Forecast skeleton */}
        <div className="space-y-5">
          <div className="pib-skeleton h-4 w-40" />
          <div className="flex gap-4">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-32" />)}
          </div>
          <Skeleton className="h-56" />
        </div>
        <div className="space-y-5">
          <div className="pib-skeleton h-4 w-44" />
          <Skeleton className="h-44" />
        </div>
        <div className="space-y-5">
          <div className="pib-skeleton h-4 w-44" />
          <Skeleton className="h-44" />
        </div>
        {/* Activity skeleton */}
        <div className="space-y-5">
          <div className="pib-skeleton h-4 w-44" />
          <Skeleton className="h-40" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-12">
      {/* Page header */}
      <header>
        <p className="eyebrow">CRM</p>
        <h1 className="pib-page-title mt-2">CRM Reports</h1>
        <p className="pib-page-sub max-w-2xl">
          Contact pipeline, revenue forecast, and activity analytics for your CRM.
        </p>
      </header>

      {/* ── Section 1: Contact pipeline ─────────────────────────────────────── */}
      <Section eyebrow="Contact pipeline">
        {!funnel ? (
          <div className="bento-card p-10 text-center">
            <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)]">contacts</span>
            <p className="text-sm text-[var(--color-pib-text-muted)] mt-4">No contact data yet.</p>
          </div>
        ) : (
          <>
            {/* By type — 4 stat cards */}
            <div>
              <p className="text-xs text-[var(--color-pib-text-muted)] mb-3 font-medium">By type</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Leads" value={fmtNum(funnel.byType.lead)} sub="top of funnel" icon="person_add" />
                <StatCard label="Prospects" value={fmtNum(funnel.byType.prospect)} sub="being evaluated" icon="manage_accounts" />
                <StatCard label="Clients" value={fmtNum(funnel.byType.client)} sub="active" icon="handshake" />
                <StatCard label="Churned" value={fmtNum(funnel.byType.churned)} sub="lost" icon="person_remove" />
              </div>
            </div>

            {/* By stage — horizontal bar chart */}
            {byStageEntries.length > 0 && (
              <div className="bento-card !p-5">
                <p className="text-xs text-[var(--color-pib-text-muted)] mb-4 font-medium">By stage</p>
                <HBarChart entries={byStageEntries} />
              </div>
            )}
          </>
        )}
      </Section>

      {/* ── Section 2: Revenue forecast ─────────────────────────────────────── */}
      <Section eyebrow="Revenue forecast">
        {!forecast ? (
          <div className="bento-card p-10 text-center">
            <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)]">trending_up</span>
            <p className="text-sm text-[var(--color-pib-text-muted)] mt-4">No forecast data yet.</p>
          </div>
        ) : (
          <>
            {/* Summary chips */}
            <div className="flex gap-3 flex-wrap">
              <SummaryChip label="Open deals" value={fmtNum(forecast.summary.totalOpenDeals)} />
              <SummaryChip label="Total pipeline" value={fmtZar(forecast.summary.totalValue)} />
              <SummaryChip label="Weighted pipeline" value={fmtZar(forecast.summary.weightedValue)} />
            </div>

            {/* Forecast table */}
            <div className="bento-card !p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]">
                    {['Period', 'Deals', 'Total value', 'Weighted value'].map((h) => (
                      <th
                        key={h}
                        className={`px-4 py-3 text-xs font-label uppercase tracking-widest text-[var(--color-pib-text-muted)] ${h === 'Period' ? 'text-left' : 'text-right'}`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <ForecastRow label="This month" period={forecast.periods.thisMonth} />
                  <ForecastRow label="Next month" period={forecast.periods.nextMonth} />
                  <ForecastRow label="This quarter" period={forecast.periods.thisQuarter} />
                  <ForecastRow label="Next quarter" period={forecast.periods.nextQuarter} />
                  <ForecastRow label="Beyond" period={forecast.periods.beyond} />
                  <ForecastRow label="No close date" period={forecast.periods.noDate} />
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>

      {/* ── Section 3: Pipeline velocity ───────────────────────────────────── */}
      <Section eyebrow="Pipeline velocity">
        {!velocity || velocity.stages.length === 0 ? (
          <div className="bento-card p-10 text-center">
            <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)]">speed</span>
            <p className="text-sm text-[var(--color-pib-text-muted)] mt-4">No time-in-stage data yet.</p>
          </div>
        ) : (
          <div className="grid lg:grid-cols-[260px_1fr] gap-4">
            <div className="pib-stat-card">
              <p className="eyebrow !text-[10px]">Bottlenecks</p>
              <p className="mt-3 font-display tracking-tight leading-none text-4xl text-[var(--color-pib-text)]">
                {fmtNum(velocity.summary.bottleneckCount)}
              </p>
              <p className="mt-3 text-xs text-[var(--color-pib-text-muted)]">
                {velocity.summary.slowestStage
                  ? `${velocity.summary.slowestStage.stageId} averages ${velocity.summary.slowestStage.avgDays.toFixed(1)} days`
                  : 'No slow stages yet'}
              </p>
            </div>

            <div className="bento-card !p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]">
                    {['Stage', 'Open deals', 'Avg days', 'Max days', 'Status'].map((h) => (
                      <th
                        key={h}
                        className={`px-4 py-3 text-xs font-label uppercase tracking-widest text-[var(--color-pib-text-muted)] ${h === 'Stage' ? 'text-left' : 'text-right'}`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {velocity.stages.slice(0, 8).map((stage) => (
                    <tr key={`${stage.pipelineId}:${stage.stageId}`} className="border-b border-[var(--color-pib-line)] last:border-0">
                      <td className="px-4 py-3 text-sm font-medium text-[var(--color-pib-text)]">{stage.stageId}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono text-[var(--color-pib-text)]">{fmtNum(stage.dealCount)}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono text-[var(--color-pib-text)]">{stage.avgDays.toFixed(1)}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono text-[var(--color-pib-text)]">{stage.maxDays.toFixed(1)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-medium ${stage.bottleneck ? 'bg-red-500/10 text-red-300' : 'bg-emerald-500/10 text-emerald-300'}`}>
                          {stage.bottleneck ? 'Bottleneck' : 'Healthy'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>

      {/* ── Section 4: Rep performance ─────────────────────────────────────── */}
      <Section eyebrow="Rep performance">
        {!repPerformance || repPerformance.reps.length === 0 ? (
          <div className="bento-card p-10 text-center">
            <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)]">groups</span>
            <p className="text-sm text-[var(--color-pib-text-muted)] mt-4">No rep performance data yet.</p>
          </div>
        ) : (
          <div className="bento-card !p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]">
                  {['Rep', 'Won', 'Open', 'Lost', 'Won value', 'Activities', 'Win rate'].map((h) => (
                    <th
                      key={h}
                      className={`px-4 py-3 text-xs font-label uppercase tracking-widest text-[var(--color-pib-text-muted)] ${h === 'Rep' ? 'text-left' : 'text-right'}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {repPerformance.reps.slice(0, 8).map((rep) => (
                  <tr key={rep.uid} className="border-b border-[var(--color-pib-line)] last:border-0">
                    <td className="px-4 py-3 text-sm font-medium text-[var(--color-pib-text)]">{rep.displayName}</td>
                    <td className="px-4 py-3 text-sm text-right font-mono text-[var(--color-pib-text)]">{fmtNum(rep.wonDeals)}</td>
                    <td className="px-4 py-3 text-sm text-right font-mono text-[var(--color-pib-text)]">{fmtNum(rep.openDeals)}</td>
                    <td className="px-4 py-3 text-sm text-right font-mono text-[var(--color-pib-text)]">{fmtNum(rep.lostDeals)}</td>
                    <td className="px-4 py-3 text-sm text-right font-mono text-[var(--color-pib-accent)]">{fmtZar(rep.wonValue)}</td>
                    <td className="px-4 py-3 text-sm text-right font-mono text-[var(--color-pib-text)]">{fmtNum(rep.activities)}</td>
                    <td className="px-4 py-3 text-sm text-right font-mono text-[var(--color-pib-text)]">
                      {rep.winRate === null ? '—' : `${Math.round(rep.winRate * 100)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── Section 5: Activity ─────────────────────────────────────────────── */}
      <Section
        eyebrow={
          <span className="flex items-center gap-3 flex-wrap">
            <span>Activity last {days} days</span>
            <span className="flex items-center gap-1">
              {DAY_OPTIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => handleDaysChange(d)}
                  className={[
                    'text-[10px] font-mono px-2.5 py-1 rounded-md transition-colors cursor-pointer',
                    d === days
                      ? 'bg-[var(--color-pib-accent)] text-black font-semibold'
                      : 'text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.06]',
                  ].join(' ')}
                >
                  {d}
                </button>
              ))}
            </span>
          </span>
        }
      >
        {activityLoading ? (
          <Skeleton className="h-52" />
        ) : !activity ? (
          <div className="bento-card p-10 text-center">
            <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)]">event_note</span>
            <p className="text-sm text-[var(--color-pib-text-muted)] mt-4">No activity data yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Total + sparkline */}
            <div className="bento-card !p-5 space-y-4">
              <div>
                <p className="font-display tracking-tight leading-none text-5xl text-[var(--color-pib-text)]">
                  {fmtNum(activity.total)}
                </p>
                <p className="text-xs text-[var(--color-pib-text-muted)] mt-2">
                  activities in the last {activity.days} days
                </p>
              </div>
              {activity.perDay.length > 0 && (
                <div>
                  <p className="text-[10px] text-[var(--color-pib-text-muted)] mb-2 uppercase tracking-widest font-label">Per day</p>
                  <Sparkline perDay={activity.perDay} />
                </div>
              )}
            </div>

            {/* By type — horizontal bar chart */}
            <div className="bento-card !p-5">
              <p className="text-xs text-[var(--color-pib-text-muted)] mb-4 font-medium">By type</p>
              {byTypeEntries.length === 0 ? (
                <p className="text-sm text-[var(--color-pib-text-muted)]">No activities recorded.</p>
              ) : (
                <HBarChart entries={byTypeEntries} />
              )}
            </div>
          </div>
        )}
      </Section>
    </div>
  )
}
