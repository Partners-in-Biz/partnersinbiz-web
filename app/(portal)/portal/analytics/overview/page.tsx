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
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <AnalyticsNav active="overview" propertyId={propertyId} />
      <header>
        <p className="eyebrow">Analytics · Overview</p>
        <h1 className="pib-page-title mt-2">Overview</h1>
      </header>

      <div className="pib-card space-y-4">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} />
        {propertyId && <DateRangePicker value={range} onChange={setRange} />}
      </div>

      {!propertyId && (
        <div className="pib-empty-state">
          <span aria-hidden="true" className="material-symbols-outlined pib-empty-state-icon">monitoring</span>
          <p className="pib-empty-state-description">Select a client and property to see the overview.</p>
        </div>
      )}

      {propertyId && loading && <div className="pib-skeleton h-24" />}

      {propertyId && k && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label="Sessions" value={k.sessions.toLocaleString()} accent />
            <KpiCard label="Unique Visitors" value={k.uniqueVisitors.toLocaleString()} />
            <KpiCard label="Pageviews" value={k.pageviews.toLocaleString()} />
            <KpiCard label="Active Now" value={k.realtimeVisitors} sub="last 5 min" />
            <KpiCard label="Bounce Rate" value={`${k.bounceRate}%`} />
            <KpiCard label="Avg Session" value={fmtDuration(k.avgDurationSec)} />
            <KpiCard label="Pages / Session" value={k.pagesPerSession} />
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            <div className="pib-card lg:col-span-2">
              <div className="mb-3 flex items-center gap-3">
                <span aria-hidden="true" className="pib-icon-tint pib-icon-tint-violet"><span className="material-symbols-outlined text-[18px]">show_chart</span></span>
                <h2 className="pib-label mb-0">Sessions over time</h2>
              </div>
              <LineSeries data={data!.sessionsSeries} xKey="date" yKey="sessions" />
            </div>
            <div className="pib-card">
              <div className="mb-3 flex items-center gap-3">
                <span aria-hidden="true" className="pib-icon-tint pib-icon-tint-violet"><span className="material-symbols-outlined text-[18px]">alt_route</span></span>
                <h2 className="pib-label mb-0">Traffic sources</h2>
              </div>
              <DonutChart data={data!.trafficSources} />
            </div>
          </div>

          <div>
            <h2 className="pib-label mb-2">Top pages</h2>
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
