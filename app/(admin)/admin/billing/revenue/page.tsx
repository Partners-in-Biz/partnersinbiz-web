'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '@/components/ui/AppFoundation'
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
    <div className="pib-stat-card" data-module-accent="cyan">
      <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">{label}</p>
      <p
        className="text-xl font-medium mt-1 tabular-nums"
        style={{ color: accent ? 'var(--color-pib-cyan)' : undefined }}
      >
        {value}
      </p>
      {hint && <p className="text-xs text-[var(--color-pib-text-muted)]/70 mt-0.5">{hint}</p>}
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
    <div className="space-y-4 max-w-6xl mx-auto" data-module-accent="cyan">
      <PageHeader
        accent="cyan"
        eyebrow="Billing / Revenue"
        title="Revenue & MRR"
        description="Recurring revenue, churn, expansion, and collections across all client accounts. All figures ZAR."
        actions={
          <a
            href="/api/v1/admin/billing/revenue/export"
            className="st-btn st-btn--secondary st-btn--sm"
            download
          >
            Export CSV
          </a>
        }
      />

      {error && (
        <div className="st-panel border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-[var(--st-danger)]">
          {error}
        </div>
      )}

      {/* Metric cards */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-[6px]" />
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
      <div className="st-panel p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-headline font-medium text-[var(--color-pib-text)]">Collected revenue</h2>
            <p className="text-[11px] text-[var(--color-pib-text-muted)]/70">Monthly, last 12 months</p>
          </div>
        </div>
        {loading ? (
          <Skeleton className="h-64 rounded-[6px]" />
        ) : !trendData.length || trendData.every((t) => t.collectedZar === 0) ? (
          <div className="h-64 flex items-center justify-center text-sm text-[var(--color-pib-text-muted)]">
            No collected revenue recorded yet.
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-pib-cyan)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--color-pib-cyan)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: 'var(--color-pib-text-muted, #9ca3af)' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: 'var(--color-pib-text-muted, #9ca3af)' }}
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
                  labelStyle={{ color: 'var(--color-pib-text, #fff)' }}
                  formatter={(value) => [formatZar(Number(value)), 'Collected']}
                />
                <Area
                  type="monotone"
                  dataKey="collectedZar"
                  stroke="var(--color-pib-cyan)"
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
        <div className="st-panel p-5">
          <h2 className="text-sm font-headline font-medium text-[var(--color-pib-text)] mb-4">Plan distribution</h2>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 rounded-lg" />
              ))}
            </div>
          ) : !data?.planDistribution.length ? (
            <p className="text-sm text-[var(--color-pib-text-muted)]">No active subscriptions yet.</p>
          ) : (
            <ul className="space-y-3">
              {data.planDistribution.map((plan) => (
                <li key={plan.planKey}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium text-[var(--color-pib-text)] truncate">{plan.planName}</span>
                    <span className="text-[var(--color-pib-text-muted)] ml-2 flex-shrink-0">
                      {plan.count} {plan.count === 1 ? 'sub' : 'subs'} · {formatZar(plan.mrrZar)}
                    </span>
                  </div>
                  <div className="h-2 rounded bg-[var(--color-pib-text)]/10 overflow-hidden">
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${Math.max(4, (plan.mrrZar / maxPlanMrr) * 100)}%`,
                        background: 'var(--color-pib-cyan)',
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Top orgs */}
        <div className="st-panel p-5">
          <h2 className="text-sm font-headline font-medium text-[var(--color-pib-text)] mb-4">Top 10 accounts by revenue</h2>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-9 rounded-lg" />
              ))}
            </div>
          ) : !data?.topOrgs.length ? (
            <p className="text-sm text-[var(--color-pib-text-muted)]">No paid revenue recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                    <th className="text-left font-label pb-2">Account</th>
                    <th className="text-right font-label pb-2">Lifetime</th>
                    <th className="text-right font-label pb-2">MRR</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topOrgs.map((org) => (
                    <tr key={org.orgId} className="border-t border-[var(--color-pib-text)]/10">
                      <td className="py-2 pr-2">
                        <Link
                          href={`/admin/org/${org.slug}/dashboard`}
                          className="text-[var(--color-pib-text)] hover:text-[var(--color-pib-cyan)] transition-colors truncate"
                        >
                          {org.name}
                        </Link>
                      </td>
                      <td className="py-2 text-right font-medium text-[var(--color-pib-text)]">
                        {formatZar(org.lifetimeZar)}
                      </td>
                      <td className="py-2 text-right text-[var(--color-pib-text-muted)]">{formatZar(org.mrrZar)}</td>
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
