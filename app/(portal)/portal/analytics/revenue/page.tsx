'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnalyticsNav } from '@/components/admin/AnalyticsNav'
import { AnalyticsPropertyPicker } from '@/components/admin/AnalyticsPropertyPicker'
import { DateRangePicker, defaultRange, type DateRangeValue } from '@/components/analytics/DateRangePicker'
import { LineSeries, BarSeries } from '@/components/analytics/Charts'
import { KpiCard, SimpleTable } from '@/components/analytics/Primitives'

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
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <AnalyticsNav active="revenue" propertyId={propertyId} />
      <h1 className="text-xl font-headline font-bold text-on-surface">Revenue</h1>

      <div className="pib-card p-4 space-y-3">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} />
        {propertyId && (
          <>
            <div>
              <label className="text-xs text-on-surface-variant font-label block mb-1">Goal</label>
              <select value={goalId} onChange={e => setGoalId(e.target.value)} className="pib-input text-sm w-72">
                <option value="">Select a goal…</option>
                {goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <DateRangePicker value={range} onChange={setRange} />
          </>
        )}
      </div>

      {!propertyId && (
        <div className="pib-card p-8 text-center text-on-surface-variant text-sm">
          Select a client and property to see revenue.
        </div>
      )}

      {propertyId && !goalId && (
        <div className="pib-card p-8 text-center text-on-surface-variant text-sm">
          Select a goal to see its revenue.
        </div>
      )}

      {goalId && loading && <div className="pib-skeleton h-24 rounded-lg" />}

      {goalId && !loading && results && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Total Value" value={`R${results.totalValue.toLocaleString()}`} accent />
            <KpiCard label="Completions" value={results.completions.toLocaleString()} />
            <KpiCard label="Completion Rate" value={`${results.completionRate}%`} />
            <KpiCard label="Revenue / session" value={revPerSession} sub="totalValue ÷ sessions" />
          </div>

          <div className="pib-card p-4 space-y-4">
            <div>
              <h2 className="text-sm font-label font-semibold text-on-surface">ROI calculator</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Enter your ad spend for this range to compare it against the tracked goal revenue.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="text-xs text-on-surface-variant font-label block mb-1">Ad spend (R)</label>
                <div className="flex items-center">
                  <span className="text-sm text-on-surface-variant mr-1">R</span>
                  <input
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
                <p className="text-xs text-on-surface-variant font-label mb-1">Tracked revenue</p>
                <p className="text-sm font-semibold text-on-surface">R{trackedRevenue.toLocaleString()}</p>
              </div>
            </div>
            {hasSpend ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
              <p className="text-xs text-on-surface-variant">Enter an ad spend above to calculate ROI and ROAS.</p>
            )}
          </div>

          <div className="pib-card p-4">
            <h2 className="text-sm font-label font-semibold text-on-surface mb-3">Revenue trend</h2>
            <LineSeries data={results.series} xKey="date" yKey="value" label="Value (R)" />
          </div>

          <div className="pib-card p-4">
            <h2 className="text-sm font-label font-semibold text-on-surface mb-3">Revenue by channel</h2>
            <BarSeries data={results.revenueByChannel} xKey="channel" yKey="value" label="Value (R)" />
          </div>

          <div>
            <h2 className="text-sm font-label font-semibold text-on-surface mb-2">Revenue by channel</h2>
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
