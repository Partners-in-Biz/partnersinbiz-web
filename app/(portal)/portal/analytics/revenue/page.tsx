'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnalyticsNav } from '@/components/admin/AnalyticsNav'
import { AnalyticsPropertyPicker } from '@/components/admin/AnalyticsPropertyPicker'
import { DateRangePicker, defaultRange, type DateRangeValue } from '@/components/analytics/DateRangePicker'
import { LineSeries, BarSeries } from '@/components/analytics/Charts'
import { KpiCard, SimpleTable } from '@/components/analytics/Primitives'
import { Icon } from '@/components/studio'
import { PageHeader, EmptyState } from '@/components/ui/AppFoundation'

interface Goal {
  id: string
  name: string
  active: boolean
}

interface GoalResults {
  goal: { id: string; name: string }
  completions: number
  totalSessions: number
  completionRate: number
  totalValue: number
  series: Array<{ date: string; completions: number; value: number }>
  revenueByChannel: Array<{ channel: string; completions: number; value: number }>
}

function rand(n: number): string {
  return `R${(Math.round(n * 100) / 100).toLocaleString()}`
}

export default function RevenuePage() {
  const sp = useSearchParams()
  const [propertyId, setPropertyId] = useState(sp?.get('propertyId') ?? '')
  const [range, setRange] = useState<DateRangeValue>(defaultRange(30))
  const [goals, setGoals] = useState<Goal[]>([])
  const [goalId, setGoalId] = useState('')
  const [results, setResults] = useState<GoalResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [adSpend, setAdSpend] = useState('')

  const loadGoals = useCallback(async () => {
    if (!propertyId) { setGoals([]); return }
    try {
      const res = await fetch(`/api/v1/analytics/conversions?propertyId=${encodeURIComponent(propertyId)}`)
      const body = await res.json()
      setGoals(res.ok ? (body.data ?? body) : [])
    } catch { setGoals([]) }
  }, [propertyId])

  useEffect(() => { loadGoals() }, [loadGoals])

  const loadResults = useCallback(async () => {
    if (!goalId) { setResults(null); return }
    setLoading(true)
    try {
      const qs = new URLSearchParams({ from: range.from, to: range.to })
      const res = await fetch(`/api/v1/analytics/conversions/${goalId}/results?${qs}`)
      const body = await res.json()
      setResults(res.ok ? (body.data ?? body) : null)
    } catch { setResults(null) } finally { setLoading(false) }
  }, [goalId, range])

  useEffect(() => { loadResults() }, [loadResults])

  const revPerSession = results && results.totalSessions > 0
    ? rand(results.totalValue / results.totalSessions)
    : 'R0'

  // ROI calculator (US-142): manual ad-spend input vs tracked goal revenue.
  const spendNum = Number.parseFloat(adSpend)
  const hasSpend = Number.isFinite(spendNum) && spendNum > 0
  const trackedRevenue = results?.totalValue ?? 0
  const profit = trackedRevenue - (hasSpend ? spendNum : 0)
  const roiPct = hasSpend ? (profit / spendNum) * 100 : null
  const roas = hasSpend ? trackedRevenue / spendNum : null
  const breakEven = hasSpend ? trackedRevenue >= spendNum : null

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6" data-module-accent="violet">
      <AnalyticsNav active="revenue" propertyId={propertyId} />
      <PageHeader
        eyebrow="Analytics · Revenue"
        title="Revenue."
      />

      <div className="st-panel space-y-4">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} />
        {propertyId && (
          <>
            <div>
              <label className="pib-label mb-1">Goal</label>
              <select name="page-select-33" value={goalId} onChange={e => setGoalId(e.target.value)} className="pib-select text-sm w-72">
                <option value="">Select a goal…</option>
                {goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <DateRangePicker value={range} onChange={setRange} />
          </>
        )}
      </div>

      {!propertyId && (
        <EmptyState title="Select a client and property to see revenue." />
      )}

      {propertyId && !goalId && (
        <EmptyState title="Select a goal to see its revenue." />
      )}

      {goalId && loading && <div className="pib-skeleton h-24" />}

      {goalId && !loading && results && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label="Total Value" value={`R${results.totalValue.toLocaleString()}`} accent />
            <KpiCard label="Completions" value={results.completions.toLocaleString()} />
            <KpiCard label="Completion Rate" value={`${results.completionRate}%`} />
            <KpiCard label="Revenue / session" value={revPerSession} sub="totalValue ÷ sessions" />
          </div>

          <div className="st-panel space-y-4">
            <div className="flex items-start gap-3">
              <Icon name="calculate" />
              <div>
                <h2 className="pib-label mb-0">ROI calculator</h2>
                <p className="text-xs text-[var(--color-pib-text-muted)] mt-0.5">
                  Enter your ad spend for this range to compare it against the tracked goal revenue.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="pib-label mb-1">Ad spend (R)</label>
                <div className="flex items-center">
                  <span className="text-sm text-[var(--color-pib-text-muted)] mr-1">R</span>
                  <input name="number"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={adSpend}
                    onChange={(e) => setAdSpend(e.target.value)}
                    placeholder="0.00"
                    className="pib-input text-sm w-40"
                  />
                </div>
              </div>
              <div>
                <p className="pib-label mb-1">Tracked revenue</p>
                <p className="text-sm text-[var(--color-pib-text)]">R{trackedRevenue.toLocaleString()}</p>
              </div>
            </div>
            {hasSpend ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KpiCard
                  label="ROI"
                  value={`${roiPct! >= 0 ? '+' : ''}${roiPct!.toFixed(0)}%`}
                  sub="(revenue − spend) ÷ spend"
                  accent={roiPct! >= 0}
                />
                <KpiCard label="ROAS" value={`${roas!.toFixed(2)}×`} sub="revenue ÷ spend" />
                <KpiCard
                  label={profit >= 0 ? 'Net profit' : 'Net loss'}
                  value={`R${Math.abs(profit).toLocaleString()}`}
                />
                <KpiCard label="Status" value={breakEven ? 'Profitable' : 'Below break-even'} />
              </div>
            ) : (
              <p className="text-xs text-[var(--color-pib-text-muted)]">Enter an ad spend above to calculate ROI and ROAS.</p>
            )}
          </div>

          <div className="st-panel">
            <div className="mb-3 flex items-center gap-3">
              <Icon name="trending_up" />
              <h2 className="pib-label mb-0">Revenue trend</h2>
            </div>
            <LineSeries data={results.series} xKey="date" yKey="value" label="Value (R)" />
          </div>

          <div className="st-panel">
            <div className="mb-3 flex items-center gap-3">
              <Icon name="bar_chart" />
              <h2 className="pib-label mb-0">Revenue by channel</h2>
            </div>
            <BarSeries data={results.revenueByChannel} xKey="channel" yKey="value" label="Value (R)" />
          </div>

          <div>
            <h2 className="pib-label mb-2">Revenue by channel</h2>
            <SimpleTable
              columns={[
                { key: 'channel', label: 'Channel' },
                { key: 'completions', label: 'Completions', align: 'right' },
                { key: 'value', label: 'Value (R)', align: 'right' },
              ]}
              rows={results.revenueByChannel}
              empty="No revenue in this range."
            />
          </div>
        </>
      )}
    </div>
  )
}
