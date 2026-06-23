'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnalyticsNav } from '@/components/admin/AnalyticsNav'
import { AnalyticsPropertyPicker } from '@/components/admin/AnalyticsPropertyPicker'
import { DateRangePicker, defaultRange, type DateRangeValue } from '@/components/analytics/DateRangePicker'
import { LineSeries, DonutChart } from '@/components/analytics/Charts'
import { KpiCard, SimpleTable } from '@/components/analytics/Primitives'

interface OverviewData {
  kpis: {
    sessions: number; uniqueVisitors: number; pageviews: number
    bounceRate: number; avgDurationSec: number; pagesPerSession: number; realtimeVisitors: number
  }
  sessionsSeries: Array<{ date: string; sessions: number }>
  trafficSources: Array<{ label: string; count: number }>
  topPages: Array<{ label: string; count: number }>
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export default function OverviewPage() {
  const sp = useSearchParams()
  const [propertyId, setPropertyId] = useState(sp?.get('propertyId') ?? '')
  const [range, setRange] = useState<DateRangeValue>(defaultRange(30))
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!propertyId) return
    setLoading(true)
    try {
      const qs = new URLSearchParams({ propertyId, from: range.from, to: range.to })
      const res = await fetch(`/api/v1/analytics/overview?${qs}`)
      const body = await res.json()
      setData(res.ok ? (body.data ?? body) : null)
    } catch { setData(null) } finally { setLoading(false) }
  }, [propertyId, range])

  useEffect(() => { load() }, [load])

  const k = data?.kpis

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <AnalyticsNav active="overview" propertyId={propertyId} />
      <h1 className="text-xl font-headline font-bold text-on-surface">Overview</h1>

      <div className="pib-card p-4 space-y-3">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} />
        {propertyId && <DateRangePicker value={range} onChange={setRange} />}
      </div>

      {!propertyId && (
        <div className="pib-card p-8 text-center text-on-surface-variant text-sm">
          Select a client and property to see the overview.
        </div>
      )}

      {propertyId && loading && <div className="pib-skeleton h-24 rounded-lg" />}

      {propertyId && k && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Sessions" value={k.sessions.toLocaleString()} accent />
            <KpiCard label="Unique Visitors" value={k.uniqueVisitors.toLocaleString()} />
            <KpiCard label="Pageviews" value={k.pageviews.toLocaleString()} />
            <KpiCard label="Active Now" value={k.realtimeVisitors} sub="last 5 min" />
            <KpiCard label="Bounce Rate" value={`${k.bounceRate}%`} />
            <KpiCard label="Avg Session" value={fmtDuration(k.avgDurationSec)} />
            <KpiCard label="Pages / Session" value={k.pagesPerSession} />
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            <div className="pib-card p-4 lg:col-span-2">
              <h2 className="text-sm font-label font-semibold text-on-surface mb-3">Sessions over time</h2>
              <LineSeries data={data!.sessionsSeries} xKey="date" yKey="sessions" />
            </div>
            <div className="pib-card p-4">
              <h2 className="text-sm font-label font-semibold text-on-surface mb-3">Traffic sources</h2>
              <DonutChart data={data!.trafficSources} />
            </div>
          </div>

          <div>
            <h2 className="text-sm font-label font-semibold text-on-surface mb-2">Top pages</h2>
            <SimpleTable
              columns={[{ key: 'label', label: 'Page' }, { key: 'count', label: 'Views', align: 'right' }]}
              rows={data!.topPages}
              empty="No pageviews in this range."
            />
          </div>
        </>
      )}
    </div>
  )
}
