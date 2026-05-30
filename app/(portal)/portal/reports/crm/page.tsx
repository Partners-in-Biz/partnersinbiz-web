'use client'
export const dynamic = 'force-dynamic'

import Link from 'next/link'
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
    totalContacts?: number
    unassignedContacts?: number
    contactOwnerCoverage?: number
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function fetchReport<T>(
  url: string,
  validate: (value: unknown) => value is T,
): Promise<T | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const body = await response.json()
    const data = isRecord(body) && 'data' in body ? body.data : body
    return validate(data) ? data : null
  } catch {
    return null
  }
}

function isFunnelData(value: unknown): value is FunnelData {
  return isRecord(value) && isRecord(value.byType) && isRecord(value.byStage) && typeof value.total === 'number'
}

function isForecastData(value: unknown): value is ForecastData {
  return isRecord(value) && isRecord(value.periods) && isRecord(value.summary)
}

function isActivityData(value: unknown): value is ActivityData {
  return isRecord(value) && isRecord(value.byType) && Array.isArray(value.perDay) && typeof value.total === 'number'
}

function isPipelineVelocityData(value: unknown): value is PipelineVelocityData {
  return isRecord(value) && Array.isArray(value.stages) && isRecord(value.summary)
}

function isRepPerformanceData(value: unknown): value is RepPerformanceData {
  return isRecord(value) && Array.isArray(value.reps) && isRecord(value.summary)
}

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmtZar(value: number): string {
  return `R ${value.toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function fmtNum(value: number): string {
  return value.toLocaleString('en-ZA', { maximumFractionDigits: 0 })
}

function fmtPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function labelize(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function dealStageLensHref(stage: PipelineVelocityStage): string {
  const params = new URLSearchParams({
    view: 'list',
    pipelineId: stage.pipelineId,
    stage: stage.stageId,
  })
  return `/portal/deals?${params.toString()}`
}

function repDealsHref(rep: RepPerformanceRow): string {
  const params = new URLSearchParams({
    view: 'list',
    owner: rep.uid,
  })
  return `/portal/deals?${params.toString()}`
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

function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: string
  title: string
  body: string
  action?: { href: string; label: string; ariaLabel: string; icon: string }
}) {
  return (
    <div className="bento-card p-10 text-center">
      <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)]">{icon}</span>
      <p className="mt-4 text-sm font-semibold text-[var(--color-pib-text)]">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-pib-text-muted)]">{body}</p>
      {action && (
        <Link
          href={action.href}
          aria-label={action.ariaLabel}
          className="pib-btn-primary mt-4 inline-flex items-center gap-1.5 text-sm"
        >
          <span className="material-symbols-outlined text-base">{action.icon}</span>
          {action.label}
        </Link>
      )}
    </div>
  )
}

function InsightCard({
  icon,
  label,
  title,
  body,
  action,
  tone = 'neutral',
}: {
  icon: string
  label: string
  title: string
  body: string
  action?: { href: string; label: string; ariaLabel: string; icon: string }
  tone?: 'neutral' | 'good' | 'warning'
}) {
  const toneClass =
    tone === 'good'
      ? 'border-emerald-500/20 bg-emerald-500/[0.05]'
      : tone === 'warning'
        ? 'border-amber-500/25 bg-amber-500/[0.06]'
        : 'border-[var(--color-pib-line)] bg-[var(--color-pib-card)]'
  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined mt-0.5 text-[20px] text-[var(--color-pib-accent)]">{icon}</span>
        <div className="min-w-0">
          <p className="eyebrow !text-[10px]">{label}</p>
          <p className="mt-2 text-sm font-semibold text-[var(--color-pib-text)]">{title}</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-pib-text-muted)]">{body}</p>
          {action && (
            <Link
              href={action.href}
              aria-label={action.ariaLabel}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-pib-accent)] hover:underline"
            >
              <span className="material-symbols-outlined text-[14px]">{action.icon}</span>
              {action.label}
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

function HealthBar({ value, label }: { value: number; label: string }) {
  const normalized = Math.max(0, Math.min(value, 1))
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-[var(--color-pib-text-muted)]">{label}</p>
        <p className="font-mono text-xs text-[var(--color-pib-text)]">{fmtPercent(normalized)}</p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--color-pib-line-strong)]">
        <div
          className="h-full rounded-full bg-[var(--color-pib-accent)] transition-all duration-500"
          style={{ width: `${normalized * 100}%` }}
        />
      </div>
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
      fetchReport('/api/v1/crm/reports/funnel', isFunnelData),
      fetchReport('/api/v1/crm/reports/forecast', isForecastData),
      fetchReport('/api/v1/crm/reports/pipeline-velocity', isPipelineVelocityData),
      fetchReport('/api/v1/crm/reports/rep-performance', isRepPerformanceData),
      fetchReport(`/api/v1/crm/reports/activity-summary?days=30`, isActivityData),
    ])
      .then(([funnelBody, forecastBody, velocityBody, repBody, activityBody]) => {
        setFunnel(funnelBody)
        setForecast(forecastBody)
        setVelocity(velocityBody)
        setRepPerformance(repBody)
        setActivity(activityBody)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Refetch activity when days selector changes (after initial load)
  const fetchActivity = useCallback(
    (d: DaysOption) => {
      setActivityLoading(true)
      fetchReport(`/api/v1/crm/reports/activity-summary?days=${d}`, isActivityData)
        .then((nextActivity) => setActivity(nextActivity))
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
    ? Object.entries(funnel.byStage ?? {}).sort((a, b) => b[1] - a[1])
    : []

  // ── Activity derived values ──────────────────────────────────────────────────

  const byTypeEntries: [string, number][] = activity
    ? Object.entries(activity.byType ?? {}).sort((a, b) => b[1] - a[1])
    : []

  const leadCount = funnel?.byType.lead ?? 0
  const prospectCount = funnel?.byType.prospect ?? 0
  const clientCount = funnel?.byType.client ?? 0
  const churnedCount = funnel?.byType.churned ?? 0
  const activeContactCount = leadCount + prospectCount + clientCount
  const clientMix = activeContactCount > 0 ? clientCount / activeContactCount : 0
  const prospectMix = activeContactCount > 0 ? prospectCount / activeContactCount : 0
  const topStage = byStageEntries[0] ?? null
  const forecastCoverage =
    forecast && forecast.summary.totalValue > 0 ? forecast.summary.weightedValue / forecast.summary.totalValue : 0
  const nearTermForecastValue = forecast
    ? forecast.periods.thisMonth.weightedValue + forecast.periods.nextMonth.weightedValue
    : 0
  const noDateDeals = forecast?.periods.noDate.dealCount ?? 0
  const slowestStage = velocity?.summary.slowestStage ?? null
  const bottleneckShare =
    velocity && velocity.summary.stageCount > 0 ? velocity.summary.bottleneckCount / velocity.summary.stageCount : 0
  const totalRepDeals = repPerformance
    ? repPerformance.reps.reduce((sum, rep) => sum + rep.openDeals + rep.wonDeals + rep.lostDeals, 0)
    : 0
  const unassignedRep = repPerformance?.reps.find((rep) => rep.uid === 'unassigned' || /unassigned/i.test(rep.displayName))
  const unassignedDealCount = unassignedRep ? unassignedRep.openDeals + unassignedRep.wonDeals + unassignedRep.lostDeals : 0
  const unassignedDealShare = totalRepDeals > 0 ? unassignedDealCount / totalRepDeals : 0
  const totalOwnedContactBase = repPerformance?.summary.totalContacts ?? activeContactCount
  const unassignedContacts = repPerformance?.summary.unassignedContacts ?? 0
  const contactOwnerCoverage =
    repPerformance?.summary.contactOwnerCoverage ?? (totalOwnedContactBase > 0 ? 1 - (unassignedContacts / totalOwnedContactBase) : 1)
  const topRep = repPerformance?.reps
    .filter((rep) => rep.uid !== 'unassigned' && !/unassigned/i.test(rep.displayName))
    .sort((a, b) => b.wonValue - a.wonValue || b.activities - a.activities)[0]
  const activityAverage = activity && activity.days > 0 ? activity.total / activity.days : 0
  const busiestDay = activity?.perDay.reduce<{ date: string; count: number } | null>(
    (best, day) => (!best || day.count > best.count ? day : best),
    null,
  )
  const daysWithoutActivity = activity?.perDay.filter((day) => day.count === 0).length ?? 0
  const pipelineSignal =
    forecastCoverage >= 0.5 && bottleneckShare <= 0.25 && unassignedDealShare <= 0.1 && contactOwnerCoverage >= 0.9
      ? 'Healthy'
      : forecastCoverage >= 0.3
        ? 'Needs focus'
        : 'At risk'
  const pipelineSignalTone = pipelineSignal === 'Healthy' ? 'good' : pipelineSignal === 'Needs focus' ? 'warning' : 'neutral'
  const teamExecutionAction =
    unassignedContacts > 0
      ? {
          href: '/portal/contacts?owner=unowned',
          label: 'Review owner gaps',
          ariaLabel: 'Open unowned contacts from team execution report',
          icon: 'manage_accounts',
        }
      : unassignedDealCount > 0
        ? {
            href: '/portal/deals?view=list&owner=unassigned',
            label: 'Review deal owners',
            ariaLabel: 'Open unassigned deals from team execution report',
            icon: 'manage_accounts',
          }
        : undefined

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
          A command view for pipeline quality, revenue coverage, team execution, and the actions that need attention.
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-5">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="eyebrow">Executive signal</p>
              <h2 className="mt-3 font-display text-3xl tracking-tight text-[var(--color-pib-text)]">{pipelineSignal}</h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--color-pib-text-muted)]">
                Weighted forecast, stage velocity, ownership hygiene, and activity rhythm are combined here so CRM review starts with decisions, not spreadsheet reading.
              </p>
            </div>
            <span
              className={[
                'inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold',
                pipelineSignalTone === 'good'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : pipelineSignalTone === 'warning'
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                    : 'border-red-500/25 bg-red-500/10 text-red-200',
              ].join(' ')}
            >
              <span className="material-symbols-outlined text-[16px]">monitoring</span>
              {pipelineSignal}
            </span>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Contacts" value={fmtNum(funnel?.total ?? 0)} sub={`${fmtPercent(clientMix)} clients in active base`} icon="contacts" />
            <StatCard label="Open pipeline" value={fmtZar(forecast?.summary.totalValue ?? 0)} sub={`${fmtZar(forecast?.summary.weightedValue ?? 0)} weighted`} icon="payments" />
            <StatCard label="Bottlenecks" value={fmtNum(velocity?.summary.bottleneckCount ?? 0)} sub={`${fmtPercent(bottleneckShare)} of tracked stages`} icon="speed" />
            <StatCard label="Contact owners" value={fmtPercent(contactOwnerCoverage)} sub={`${fmtNum(unassignedContacts)} unowned contacts`} icon="supervisor_account" />
            <StatCard label="Activity" value={fmtNum(activity?.total ?? 0)} sub={`${activityAverage.toFixed(1)} per day over ${days} days`} icon="task_alt" />
          </div>
        </div>

        <div className="bento-card !p-6 space-y-5">
          <div>
            <p className="eyebrow">Analytics health</p>
            <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">Signals that should be reviewed before the next sales standup.</p>
          </div>
          <HealthBar value={forecastCoverage} label="Forecast confidence" />
          <HealthBar value={1 - bottleneckShare} label="Stage movement health" />
          <HealthBar value={1 - unassignedDealShare} label="Deal ownership hygiene" />
          <HealthBar value={contactOwnerCoverage} label="Contact owner coverage" />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <InsightCard
          icon="moving"
          label="Funnel shape"
          title={topStage ? `${labelize(topStage[0])} holds ${fmtNum(topStage[1])} contacts` : 'No dominant stage yet'}
          body={`${fmtPercent(prospectMix)} of active contacts are prospects and ${fmtNum(churnedCount)} contacts are churned.`}
          action={topStage ? {
            href: `/portal/contacts?stage=${encodeURIComponent(topStage[0])}`,
            label: 'Review stage',
            ariaLabel: `Open contacts in dominant ${labelize(topStage[0])} stage`,
            icon: 'contacts',
          } : {
            href: '/portal/contacts?create=contact',
            label: 'Classify contact stages',
            ariaLabel: 'Open contacts to classify funnel stages',
            icon: 'contacts',
          }}
          tone={clientMix >= 0.25 ? 'good' : prospectMix >= 0.35 ? 'warning' : 'neutral'}
        />
        <InsightCard
          icon="event_upcoming"
          label="Forecast focus"
          title={`${fmtZar(nearTermForecastValue)} weighted near term`}
          body={`${fmtNum(noDateDeals)} open deals have no close date, which limits forecast reliability.`}
          action={noDateDeals > 0 ? {
            href: '/portal/deals?view=forecast&focus=no-close-date',
            label: 'Review dates',
            ariaLabel: 'Open forecast deals missing close dates',
            icon: 'edit_calendar',
          } : undefined}
          tone={noDateDeals === 0 ? 'good' : 'warning'}
        />
        <InsightCard
          icon="timer"
          label="Velocity"
          title={slowestStage ? `${labelize(slowestStage.stageId)} is slowest` : 'No slowest stage yet'}
          body={slowestStage ? `Average age is ${slowestStage.avgDays.toFixed(1)} days with a max of ${slowestStage.maxDays.toFixed(1)} days.` : 'Stage age will appear once deals have enough movement history.'}
          action={slowestStage ? {
            href: dealStageLensHref(slowestStage),
            label: 'Review stage',
            ariaLabel: `Open deals in slowest ${labelize(slowestStage.stageId)} stage`,
            icon: 'view_list',
          } : {
            href: '/portal/deals?create=deal',
            label: 'Review pipeline',
            ariaLabel: 'Open pipeline to build stage velocity insight',
            icon: 'view_kanban',
          }}
          tone={velocity && velocity.summary.bottleneckCount === 0 ? 'good' : 'warning'}
        />
        <InsightCard
          icon="groups"
          label="Team execution"
          title={
            unassignedContacts > 0
              ? `${fmtNum(unassignedContacts)} contacts need an owner`
              : unassignedDealCount > 0
                ? `${fmtNum(unassignedDealCount)} deals need an owner`
                : topRep
                  ? `${topRep.displayName} leads won value`
                  : 'Ownership is clean'
          }
          body={`${fmtPercent(unassignedDealShare)} of tracked deals are unassigned. Contact owner coverage is ${fmtPercent(contactOwnerCoverage)}.`}
          action={teamExecutionAction}
          tone={unassignedDealShare <= 0.1 && contactOwnerCoverage >= 0.9 ? 'good' : 'warning'}
        />
      </section>

      {/* ── Section 1: Contact pipeline ─────────────────────────────────────── */}
      <Section eyebrow="Contact pipeline">
        {!funnel ? (
          <EmptyState
            icon="contacts"
            title="No contact data yet"
            body="Contacts will populate the funnel as leads, prospects, clients, and churned accounts are created."
            action={{
              href: '/portal/contacts?create=contact',
              label: 'Open contacts',
              ariaLabel: 'Open contacts to create reportable CRM records',
              icon: 'contacts',
            }}
          />
        ) : (
          <>
            {/* By type — 4 stat cards */}
            <div>
              <p className="text-xs text-[var(--color-pib-text-muted)] mb-3 font-medium">By type</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Leads" value={fmtNum(funnel.byType.lead ?? 0)} sub="top of funnel" icon="person_add" />
                <StatCard label="Prospects" value={fmtNum(funnel.byType.prospect ?? 0)} sub="being evaluated" icon="manage_accounts" />
                <StatCard label="Clients" value={fmtNum(funnel.byType.client ?? 0)} sub="active" icon="handshake" />
                <StatCard label="Churned" value={fmtNum(funnel.byType.churned ?? 0)} sub="lost" icon="person_remove" />
              </div>
            </div>

            {/* By stage — horizontal bar chart */}
            <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
              <div className="bento-card !p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-[var(--color-pib-text-muted)]">By stage</p>
                  {topStage && (
                    <span className="rounded-full bg-white/[0.04] px-2 py-1 text-[11px] text-[var(--color-pib-text-muted)]">
                      Top stage: {labelize(topStage[0])}
                    </span>
                  )}
                </div>
                {byStageEntries.length > 0 ? (
                  <HBarChart entries={byStageEntries} />
                ) : (
                  <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-4">
                    <p className="eyebrow !text-[10px] text-amber-200">Stage mix missing</p>
                    <h3 className="mt-1 text-sm font-semibold text-[var(--color-pib-text)]">Classify contacts into funnel stages</h3>
                    <p className="mt-1 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                      There are contacts in CRM, but none are grouped by stage yet. Classify the next contact so leadership can see where the pipeline is stuck.
                    </p>
                    <Link
                      href="/portal/contacts?create=contact"
                      aria-label="Open contacts to classify missing stage mix"
                      className="pib-btn-secondary mt-3 inline-flex items-center gap-1.5 text-xs"
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-[14px]">filter_alt</span>
                      Classify contacts
                    </Link>
                  </div>
                )}
              </div>
              <div className="bento-card !p-5 space-y-4">
                <p className="eyebrow !text-[10px]">Conversion mix</p>
                <HealthBar value={clientMix} label="Clients in active base" />
                <HealthBar value={prospectMix} label="Prospects in active base" />
                <p className="text-xs leading-relaxed text-[var(--color-pib-text-muted)]">
                  A healthy CRM makes it obvious where contacts are stuck and whether the active base is becoming revenue.
                </p>
              </div>
            </div>
          </>
        )}
      </Section>

      {/* ── Section 2: Revenue forecast ─────────────────────────────────────── */}
      <Section eyebrow="Revenue forecast">
        {!forecast ? (
          <EmptyState
            icon="trending_up"
            title="No forecast data yet"
            body="Open deals with values and close dates will build the forecast automatically."
            action={{
              href: '/portal/deals?create=deal',
              label: 'Open pipeline',
              ariaLabel: 'Open pipeline to create forecast deals',
              icon: 'view_kanban',
            }}
          />
        ) : (
          <>
            {/* Summary chips */}
            <div className="flex gap-3 flex-wrap">
              <SummaryChip label="Open deals" value={fmtNum(forecast.summary.totalOpenDeals)} />
              <SummaryChip label="Total pipeline" value={fmtZar(forecast.summary.totalValue)} />
              <SummaryChip label="Weighted pipeline" value={fmtZar(forecast.summary.weightedValue)} />
              <SummaryChip label="Near term" value={fmtZar(nearTermForecastValue)} />
            </div>

            {/* Forecast table */}
            <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
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
              <div className="bento-card !p-5 space-y-5">
                <div>
                  <p className="eyebrow !text-[10px]">Forecast discipline</p>
                  <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">Close dates and probabilities decide how believable the pipeline is.</p>
                </div>
                <HealthBar value={forecastCoverage} label="Weighted against total" />
                <InsightCard
                  icon="edit_calendar"
                  label="Close-date hygiene"
                  title={`${fmtNum(noDateDeals)} deals need a date`}
                  body="No-date deals are still visible, but they should not be allowed to hide from forecast review."
                  action={noDateDeals > 0 ? {
                    href: '/portal/deals?view=forecast&focus=no-close-date',
                    label: 'Review dates',
                    ariaLabel: 'Open forecast close-date hygiene list',
                    icon: 'edit_calendar',
                  } : undefined}
                  tone={noDateDeals === 0 ? 'good' : 'warning'}
                />
              </div>
            </div>
          </>
        )}
      </Section>

      {/* ── Section 3: Pipeline velocity ───────────────────────────────────── */}
      <Section eyebrow="Pipeline velocity">
        {!velocity || velocity.stages.length === 0 ? (
          <EmptyState
            icon="speed"
            title="No time-in-stage data yet"
            body="Velocity appears once deals are moving through tracked pipeline stages."
            action={{
              href: '/portal/deals?create=deal',
              label: 'Open pipeline',
              ariaLabel: 'Open pipeline to move deals through tracked stages',
              icon: 'view_kanban',
            }}
          />
        ) : (
          <div className="grid lg:grid-cols-[260px_1fr] gap-4">
            <div className="pib-stat-card">
              <p className="eyebrow !text-[10px]">Bottlenecks</p>
              <p className="mt-3 font-display tracking-tight leading-none text-4xl text-[var(--color-pib-text)]">
                {fmtNum(velocity.summary.bottleneckCount)}
              </p>
              <p className="mt-3 text-xs text-[var(--color-pib-text-muted)]">
                {velocity.summary.slowestStage
                  ? `${labelize(velocity.summary.slowestStage.stageId)} averages ${velocity.summary.slowestStage.avgDays.toFixed(1)} days`
                  : 'No slow stages yet'}
              </p>
              {velocity.summary.slowestStage ? (
                <Link
                  href={dealStageLensHref(velocity.summary.slowestStage)}
                  aria-label={`Review deals in slowest ${labelize(velocity.summary.slowestStage.stageId)} stage from bottleneck summary`}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-pib-accent)] hover:underline"
                >
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">view_list</span>
                  Review slow stage
                </Link>
              ) : (
                <Link
                  href="/portal/deals?create=deal"
                  aria-label="Review pipeline movement from bottleneck summary"
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-pib-accent)] hover:underline"
                >
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">view_kanban</span>
                  Review movement
                </Link>
              )}
              <div className="mt-5">
                <HealthBar value={1 - bottleneckShare} label="Movement health" />
              </div>
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
                      <td className="px-4 py-3 text-sm font-medium text-[var(--color-pib-text)]">{labelize(stage.stageId)}</td>
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
          <EmptyState
            icon="groups"
            title="No rep performance data yet"
            body="Rep metrics will appear once deals and activities have owners."
            action={{
              href: '/portal/settings/team',
              label: 'Open team',
              ariaLabel: 'Open team settings to prepare CRM rep reporting',
              icon: 'groups',
            }}
          />
        ) : (
          <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
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
                      <td className="px-4 py-3 text-sm font-medium text-[var(--color-pib-text)]">
                        <Link
                          href={repDealsHref(rep)}
                          aria-label={`Open ${rep.displayName} deals from rep performance report`}
                          className="inline-flex max-w-full items-center gap-1.5 rounded-md text-[var(--color-pib-text)] transition-colors hover:text-[var(--color-pib-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-pib-accent)] focus:ring-offset-2 focus:ring-offset-[var(--color-pib-bg)]"
                        >
                          <span className="truncate">{rep.displayName}</span>
                          <span className="material-symbols-outlined text-[15px]" aria-hidden="true">open_in_new</span>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-mono text-[var(--color-pib-text)]">{fmtNum(rep.wonDeals)}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono text-[var(--color-pib-text)]">{fmtNum(rep.openDeals)}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono text-[var(--color-pib-text)]">{fmtNum(rep.lostDeals)}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono text-[var(--color-pib-accent)]">{fmtZar(rep.wonValue)}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono text-[var(--color-pib-text)]">{fmtNum(rep.activities)}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono text-[var(--color-pib-text)]">
                        {rep.winRate === null ? '—' : fmtPercent(rep.winRate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="bento-card !p-5 space-y-5">
              <div>
                <p className="eyebrow !text-[10px]">Ownership</p>
                <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">Performance reporting is only useful when contacts and deals have accountable owners.</p>
              </div>
              <HealthBar value={1 - unassignedDealShare} label="Assigned deal coverage" />
              <HealthBar value={contactOwnerCoverage} label="Assigned contact coverage" />
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
                  <p className="eyebrow !text-[10px]">Won value</p>
                  <p className="mt-2 font-display text-xl font-bold text-[var(--color-pib-text)]">{fmtZar(repPerformance.summary.totalWonValue)}</p>
                </div>
                <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
                  <p className="eyebrow !text-[10px]">Activities</p>
                  <p className="mt-2 font-display text-xl font-bold text-[var(--color-pib-text)]">{fmtNum(repPerformance.summary.totalActivities)}</p>
                </div>
                <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
                  <p className="eyebrow !text-[10px]">Contact owners</p>
                  <p className="mt-2 font-display text-xl font-bold text-[var(--color-pib-text)]">{fmtPercent(contactOwnerCoverage)}</p>
                </div>
                <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
                  <p className="eyebrow !text-[10px]">Unowned</p>
                  <p className="mt-2 font-display text-xl font-bold text-[var(--color-pib-text)]">{fmtNum(unassignedContacts)}</p>
                </div>
              </div>
            </div>
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
          <EmptyState
            icon="event_note"
            title="No activity data yet"
            body="Calls, emails, meetings, notes, and tasks will build the activity pulse."
            action={{
              href: '/portal/contacts?followUp=stale',
              label: 'Open contacts',
              ariaLabel: 'Open contacts to log CRM activity',
              icon: 'contacts',
            }}
          />
        ) : (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_1fr_320px]">
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
                <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-4">
                  <p className="eyebrow !text-[10px] text-amber-200">Activity mix missing</p>
                  <h3 className="mt-1 text-sm font-semibold text-[var(--color-pib-text)]">Log the next CRM touch with type context</h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                    Activity exists, but calls, emails, meetings, notes, and tasks are not classified yet. Classify the next touch so leadership can see which channel is moving relationships.
                  </p>
                  <Link
                    href="/portal/contacts?followUp=stale"
                    aria-label="Open contacts to log typed CRM activity"
                    className="pib-btn-secondary mt-3 inline-flex items-center gap-1.5 text-xs"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[14px]">edit_note</span>
                    Log typed activity
                  </Link>
                </div>
              ) : (
                <HBarChart entries={byTypeEntries} />
              )}
            </div>

            <div className="bento-card !p-5 space-y-4">
              <div>
                <p className="eyebrow !text-[10px]">Rhythm</p>
                <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">Use this to spot quiet periods before pipeline follow-up slips.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
                  <p className="eyebrow !text-[10px]">Best day</p>
                  <p className="mt-2 text-sm font-semibold text-[var(--color-pib-text)]">
                    {busiestDay ? `${busiestDay.date}` : 'None'}
                  </p>
                  <p className="mt-1 font-mono text-xs text-[var(--color-pib-text-muted)]">{fmtNum(busiestDay?.count ?? 0)} activities</p>
                </div>
                <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
                  <p className="eyebrow !text-[10px]">Quiet days</p>
                  <p className="mt-2 font-display text-2xl font-bold text-[var(--color-pib-text)]">{fmtNum(daysWithoutActivity)}</p>
                  <p className="mt-1 font-mono text-xs text-[var(--color-pib-text-muted)]">of {fmtNum(activity.perDay.length)}</p>
                  {daysWithoutActivity > 0 && (
                    <Link
                      href="/portal/contacts?followUp=stale"
                      aria-label="Open contacts needing follow-up from activity rhythm"
                      className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-pib-accent)] hover:underline"
                    >
                      <span className="material-symbols-outlined text-[14px]" aria-hidden="true">event_note</span>
                      Review follow-up
                    </Link>
                  )}
                </div>
              </div>
              <HealthBar value={activity.days > 0 ? 1 - daysWithoutActivity / activity.days : 0} label="Activity consistency" />
            </div>
          </div>
        )}
      </Section>
    </div>
  )
}
