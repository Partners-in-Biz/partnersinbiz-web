'use client'

export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useState } from 'react'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { formatZar, formatPct, formatMonthLabel } from '@/lib/billing/format'

interface ChurnSummary {
  churnedCount: number
  mrrLostZar: number
  churnRate: number
}

interface ChurnReasonRow {
  reason: string
  label: string
  count: number
  mrrLostZar: number
}

interface AtRiskRow {
  orgId: string
  name: string
  slug: string
  reason: string
  mrrZar: number
}

interface CohortRow {
  cohortMonth: string
  startCount: number
  retainedCount: number
  retentionPct: number
}

interface ChurnData {
  summary: ChurnSummary
  reasons: ChurnReasonRow[]
  atRisk: AtRiskRow[]
  cohorts: CohortRow[]
}

const REASON_COLORS = [
  'var(--color-accent-v2)',
  '#2563eb',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#6b7280',
]

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function reasonBadge(reason: string): string {
  if (reason === 'past_due') return 'Past due'
  if (reason === 'paused') return 'Paused'
  return reason
}

export default function ChurnPage() {
  const [data, setData] = useState<ChurnData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyOrgId, setBusyOrgId] = useState<string | null>(null)
  const [triggered, setTriggered] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/admin/billing/churn')
      const body = await res.json()
      if (!res.ok) {
        setError(body?.error ?? 'Failed to load churn data')
        setData(null)
      } else {
        setData((body.data ?? body) as ChurnData)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load churn data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function triggerWinback(row: AtRiskRow) {
    setBusyOrgId(row.orgId)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/v1/admin/billing/churn/${row.orgId}/winback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Failed to trigger win-back')
      setTriggered((prev) => ({ ...prev, [row.orgId]: true }))
      setNotice(`Win-back triggered for ${row.name}. The team has been notified.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger win-back')
    } finally {
      setBusyOrgId(null)
    }
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
          Billing / Retention
        </p>
        <h1 className="text-2xl font-headline font-bold text-on-surface">Churn &amp; Win-back</h1>
        <p className="text-sm text-on-surface-variant mt-0.5">
          Track churned revenue, why customers leave, who is at risk, and cohort retention over time.
        </p>
      </div>

      {error && (
        <div className="pib-card border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {notice && (
        <div className="pib-card border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm text-green-400">
          {notice}
        </div>
      )}

      {/* Summary cards */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      ) : data ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="pib-card p-4">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
              Churned customers
            </p>
            <p className="text-2xl font-headline font-bold text-on-surface mt-1">
              {data.summary.churnedCount}
            </p>
          </div>
          <div className="pib-card p-4">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
              MRR lost
            </p>
            <p className="text-2xl font-headline font-bold text-on-surface mt-1">
              {formatZar(data.summary.mrrLostZar)}
            </p>
          </div>
          <div className="pib-card p-4">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
              Churn rate
            </p>
            <p className="text-2xl font-headline font-bold text-on-surface mt-1">
              {formatPct(data.summary.churnRate)}
            </p>
          </div>
        </div>
      ) : null}

      {/* Churn reasons */}
      <section className="pib-card p-5">
        <h2 className="text-sm font-label uppercase tracking-wide text-on-surface mb-4">
          Why customers churn
        </h2>
        {loading ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : !data || data.reasons.length === 0 ? (
          <p className="text-sm text-on-surface-variant py-8 text-center">
            No churn events recorded yet.
          </p>
        ) : (
          <>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.reasons} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-on-surface)" opacity={0.08} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: 'var(--color-on-surface-variant)' }}
                    interval={0}
                    angle={-15}
                    textAnchor="end"
                    height={50}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: 'var(--color-on-surface-variant)' }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--color-surface)',
                      border: '1px solid rgba(127,127,127,0.2)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value, _name, item) => [
                      `${value} churned · ${formatZar((item?.payload as ChurnReasonRow)?.mrrLostZar ?? 0)} lost`,
                      'Customers',
                    ]}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {data.reasons.map((_, i) => (
                      <Cell key={i} fill={REASON_COLORS[i % REASON_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {data.reasons.map((r, i) => (
                <li key={r.reason} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-on-surface-variant">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ background: REASON_COLORS[i % REASON_COLORS.length] }}
                    />
                    {r.label}
                  </span>
                  <span className="text-on-surface">
                    {r.count} · {formatZar(r.mrrLostZar)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* At-risk list */}
      <section className="pib-card p-5">
        <h2 className="text-sm font-label uppercase tracking-wide text-on-surface mb-4">
          At-risk accounts
        </h2>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" />
          </div>
        ) : !data || data.atRisk.length === 0 ? (
          <p className="text-sm text-on-surface-variant py-8 text-center">
            No accounts are currently past due or paused.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] font-label uppercase tracking-widest text-on-surface-variant border-b border-on-surface/10">
                  <th className="py-2 pr-4">Account</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4 text-right">MRR at risk</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.atRisk.map((row) => {
                  const isTriggered = triggered[row.orgId]
                  const busy = busyOrgId === row.orgId
                  return (
                    <tr key={row.orgId} className="border-b border-on-surface/5 last:border-0">
                      <td className="py-3 pr-4 text-on-surface font-medium">{row.name}</td>
                      <td className="py-3 pr-4">
                        <span
                          className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full"
                          style={{
                            background:
                              row.reason === 'past_due' ? '#ef444420' : '#f59e0b20',
                            color: row.reason === 'past_due' ? '#ef4444' : '#f59e0b',
                          }}
                        >
                          {reasonBadge(row.reason)}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-right text-on-surface">
                        {formatZar(row.mrrZar)}
                      </td>
                      <td className="py-3 text-right">
                        <button
                          onClick={() => triggerWinback(row)}
                          disabled={busy || isTriggered}
                          className="pib-btn-secondary text-xs font-label"
                        >
                          {isTriggered
                            ? 'Win-back triggered'
                            : busy
                              ? 'Working...'
                              : 'Trigger win-back'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Cohort retention */}
      <section className="pib-card p-5">
        <h2 className="text-sm font-label uppercase tracking-wide text-on-surface mb-4">
          Cohort retention
        </h2>
        {loading ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : !data || data.cohorts.length === 0 ? (
          <p className="text-sm text-on-surface-variant py-8 text-center">
            No cohorts to display yet.
          </p>
        ) : (
          <>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={data.cohorts.map((c) => ({ ...c, label: formatMonthLabel(c.cohortMonth) }))}
                  margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-on-surface)" opacity={0.08} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: 'var(--color-on-surface-variant)' }}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fontSize: 11, fill: 'var(--color-on-surface-variant)' }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--color-surface)',
                      border: '1px solid rgba(127,127,127,0.2)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value) => [`${value}%`, 'Retention']}
                  />
                  <Line
                    type="monotone"
                    dataKey="retentionPct"
                    stroke="var(--color-accent-v2)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] font-label uppercase tracking-widest text-on-surface-variant border-b border-on-surface/10">
                    <th className="py-2 pr-4">Cohort</th>
                    <th className="py-2 pr-4 text-right">Started</th>
                    <th className="py-2 pr-4 text-right">Retained</th>
                    <th className="py-2 text-right">Retention</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cohorts.map((c) => (
                    <tr key={c.cohortMonth} className="border-b border-on-surface/5 last:border-0">
                      <td className="py-2 pr-4 text-on-surface">{formatMonthLabel(c.cohortMonth)}</td>
                      <td className="py-2 pr-4 text-right text-on-surface-variant">{c.startCount}</td>
                      <td className="py-2 pr-4 text-right text-on-surface-variant">{c.retainedCount}</td>
                      <td className="py-2 text-right text-on-surface font-medium">{c.retentionPct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
