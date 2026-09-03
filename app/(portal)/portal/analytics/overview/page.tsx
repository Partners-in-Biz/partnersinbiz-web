'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnalyticsNav } from '@/components/admin/AnalyticsNav'
import { AnalyticsPropertyPicker } from '@/components/admin/AnalyticsPropertyPicker'
import { DateRangePicker, defaultRange, type DateRangeValue } from '@/components/analytics/DateRangePicker'
import { LineSeries, DonutChart } from '@/components/analytics/Charts'
import { KpiCard, SimpleTable } from '@/components/analytics/Primitives'
import { PageHeader, Surface, EmptyState } from '@/components/ui/AppFoundation'
import { Icon } from '@/components/studio'

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
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6" data-module-accent="violet">
      <AnalyticsNav active="overview" propertyId={propertyId} />
      <PageHeader
        accent="violet"
        eyebrow="Analytics · Overview"
        title="Overview."
      />

      <Surface variant="glass" className="space-y-3 !p-3">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} />
        {propertyId && <DateRangePicker value={range} onChange={setRange} />}
      </Surface>

      {!propertyId && (
        <EmptyState title="Select a client and property to see the overview." />
      )}

      {propertyId && loading && <div className="pib-skeleton h-24" />}

      {propertyId && k && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard label="Sessions" value={k.sessions.toLocaleString()} accent />
            <KpiCard label="Unique Visitors" value={k.uniqueVisitors.toLocaleString()} />
            <KpiCard label="Pageviews" value={k.pageviews.toLocaleString()} />
            <KpiCard label="Active Now" value={k.realtimeVisitors} sub="last 5 min" />
            <KpiCard label="Bounce Rate" value={`${k.bounceRate}%`} />
            <KpiCard label="Avg Session" value={fmtDuration(k.avgDurationSec)} />
            <KpiCard label="Pages / Session" value={k.pagesPerSession} />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <Surface className="!p-3 lg:col-span-2">
              <div className="mb-3 flex items-center gap-2.5">
                <Icon name="show_chart" />
                <h2 className="pib-label mb-0">Sessions over time</h2>
              </div>
              <LineSeries data={data!.sessionsSeries} xKey="date" yKey="sessions" />
            </Surface>
            <Surface className="!p-3">
              <div className="mb-3 flex items-center gap-2.5">
                <Icon name="alt_route" />
                <h2 className="pib-label mb-0">Traffic sources</h2>
              </div>
              <DonutChart data={data!.trafficSources} />
            </Surface>
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
