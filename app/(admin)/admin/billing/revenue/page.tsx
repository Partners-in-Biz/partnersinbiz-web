'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import { formatZar, formatPct, formatMonthLabel } from '@/lib/billing/format'

interface RevenueMetrics {
  mrrZar: number
  arrZar: number
  activeSubscriptions: number
  trialingSubscriptions: number
  pastDueSubscriptions: number
  newMrrZar: number
  churnedMrrZar: number
  expansionMrrZar: number
  churnRate: number
  collected30dZar: number
}

interface TrendPoint {
  month: string
  collectedZar: number
}

interface PlanDist {
  planKey: string
  planName: string
  count: number
  mrrZar: number
}

interface TopOrg {
  orgId: string
  name: string
  slug: string
  lifetimeZar: number
  mrrZar: number
}

interface RevenuePayload {
  metrics: RevenueMetrics
  trend: TrendPoint[]
  planDistribution: PlanDist[]
  topOrgs: TopOrg[]
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function MetricCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string
  value: string
  hint?: string
  accent?: boolean
}) {
  return (
    <div className="pib-card p-4">
      <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{label}</p>
      <p
        className="text-2xl font-headline font-bold mt-1"
        style={{ color: accent ? 'var(--color-accent-v2)' : undefined }}
      >
        {value}
      </p>
      {hint && <p className="text-[11px] text-on-surface-variant/70 mt-0.5">{hint}</p>}
    </div>
  )
}

export default function RevenuePage() {
  const [data, setData] = useState<RevenuePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/admin/billing/revenue')
      const body = await res.json()
      if (!res.ok) {
        throw new Error(body?.error ?? 'Failed to load revenue metrics')
      }
      setData(body.data ?? body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load revenue metrics')
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const trendData = useMemo(
    () =>
      (data?.trend ?? []).map((t) => ({
        ...t,
        label: formatMonthLabel(t.month),
      })),
    [data?.trend],
  )

  const maxPlanMrr = useMemo(
    () => Math.max(1, ...(data?.planDistribution ?? []).map((p) => p.mrrZar)),
    [data?.planDistribution],
  )

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
            Billing / Revenue
          </p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Revenue & MRR</h1>
          <p className="text-sm text-on-surface-variant mt-0.5">
            Recurring revenue, churn, expansion, and collections across all client accounts. All figures ZAR.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 self-start md:self-auto">
          <a
            href="/api/v1/admin/billing/revenue/export"
            className="pib-btn-secondary text-sm font-label"
            download
          >
            Export CSV
          </a>
        </div>
      </div>

      {error && (
        <div className="pib-card border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Metric cards */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : data ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="MRR" value={formatZar(data.metrics.mrrZar)} hint="Monthly recurring" accent />
          <MetricCard label="ARR" value={formatZar(data.metrics.arrZar)} hint="Annualised run-rate" />
          <MetricCard
            label="Active subs"
            value={String(data.metrics.activeSubscriptions)}
            hint={`${data.metrics.trialingSubscriptions} trialing · ${data.metrics.pastDueSubscriptions} past due`}
          />
          <MetricCard label="Churn rate (30d)" value={formatPct(data.metrics.churnRate)} hint="Logo churn" />
          <MetricCard label="New MRR (30d)" value={formatZar(data.metrics.newMrrZar)} hint="From new subs" />
          <MetricCard label="Churned MRR (30d)" value={formatZar(data.metrics.churnedMrrZar)} hint="From cancellations" />
          <MetricCard
            label="Net expansion (30d)"
            value={formatZar(data.metrics.expansionMrrZar)}
            hint="Upgrades − downgrades"
          />
          <MetricCard label="Collected (30d)" value={formatZar(data.metrics.collected30dZar)} hint="Paid invoices" />
        </div>
      ) : null}

      {/* Trend chart */}
      <div className="pib-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-headline font-bold text-on-surface">Collected revenue</h2>
            <p className="text-[11px] text-on-surface-variant/70">Monthly, last 12 months</p>
          </div>
        </div>
        {loading ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : !trendData.length || trendData.every((t) => t.collectedZar === 0) ? (
          <div className="h-64 flex items-center justify-center text-sm text-on-surface-variant">
            No collected revenue recorded yet.
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-accent-v2)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--color-accent-v2)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: 'var(--color-on-surface-variant, #9ca3af)' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: 'var(--color-on-surface-variant, #9ca3af)' }}
                  tickLine={false}
                  axisLine={false}
                  width={64}
                  tickFormatter={(v) => formatZar(Number(v))}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-surface, #1a1a1a)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: 'var(--color-on-surface, #fff)' }}
                  formatter={(value) => [formatZar(Number(value)), 'Collected']}
                />
                <Area
                  type="monotone"
                  dataKey="collectedZar"
                  stroke="var(--color-accent-v2)"
                  strokeWidth={2}
                  fill="url(#revFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Plan distribution + Top orgs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Plan distribution */}
        <div className="pib-card p-5">
          <h2 className="text-sm font-headline font-bold text-on-surface mb-4">Plan distribution</h2>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 rounded-lg" />
              ))}
            </div>
          ) : !data?.planDistribution.length ? (
            <p className="text-sm text-on-surface-variant">No active subscriptions yet.</p>
          ) : (
            <ul className="space-y-3">
              {data.planDistribution.map((plan) => (
                <li key={plan.planKey}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-semibold text-on-surface truncate">{plan.planName}</span>
                    <span className="text-on-surface-variant ml-2 flex-shrink-0">
                      {plan.count} {plan.count === 1 ? 'sub' : 'subs'} · {formatZar(plan.mrrZar)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-on-surface/10 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(4, (plan.mrrZar / maxPlanMrr) * 100)}%`,
                        background: 'var(--color-accent-v2)',
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Top orgs */}
        <div className="pib-card p-5">
          <h2 className="text-sm font-headline font-bold text-on-surface mb-4">Top 10 accounts by revenue</h2>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-9 rounded-lg" />
              ))}
            </div>
          ) : !data?.topOrgs.length ? (
            <p className="text-sm text-on-surface-variant">No paid revenue recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                    <th className="text-left font-label pb-2">Account</th>
                    <th className="text-right font-label pb-2">Lifetime</th>
                    <th className="text-right font-label pb-2">MRR</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topOrgs.map((org) => (
                    <tr key={org.orgId} className="border-t border-on-surface/10">
                      <td className="py-2 pr-2">
                        <Link
                          href={`/admin/org/${org.slug}/dashboard`}
                          className="text-on-surface hover:text-[var(--color-accent-v2)] transition-colors truncate"
                        >
                          {org.name}
                        </Link>
                      </td>
                      <td className="py-2 text-right font-semibold text-on-surface">
                        {formatZar(org.lifetimeZar)}
                      </td>
                      <td className="py-2 text-right text-on-surface-variant">{formatZar(org.mrrZar)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
