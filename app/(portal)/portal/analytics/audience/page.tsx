'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnalyticsNav } from '@/components/admin/AnalyticsNav'
import { AnalyticsPropertyPicker } from '@/components/admin/AnalyticsPropertyPicker'
import { DateRangePicker, defaultRange, type DateRangeValue } from '@/components/analytics/DateRangePicker'
import { SegmentFilter, EMPTY_SEGMENT, segmentToParams, loadPersistedSegment, type SegmentValue } from '@/components/analytics/SegmentFilter'
import { DonutChart } from '@/components/analytics/Charts'
import { KpiCard, SimpleTable } from '@/components/analytics/Primitives'

interface AudienceData {
  visitors: { new: number; returning: number; total: number }
  engagement: { avgDurationSec: number; pagesPerSession: number }
  devices: Array<{ label: string; count: number }>
  browsers: Array<{ label: string; count: number }>
  operatingSystems: Array<{ label: string; count: number }>
  countries: Array<{ label: string; count: number }>
  cohorts: Array<{ week: string; newVisitors: number }>
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export default function AudiencePage() {
  const sp = useSearchParams()
  const [propertyId, setPropertyId] = useState(sp?.get('propertyId') ?? '')
  const [range, setRange] = useState<DateRangeValue>(defaultRange(30))
  const [seg, setSeg] = useState<SegmentValue>(EMPTY_SEGMENT)
  const [orgId, setOrgId] = useState<string | undefined>(undefined)
  const [data, setData] = useState<AudienceData | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => { setSeg(loadPersistedSegment()) }, [])

  useEffect(() => {
    let cancelled = false
    if (!propertyId) { setOrgId(undefined); return }
    ;(async () => {
      try {
        const res = await fetch(`/api/v1/properties/${propertyId}`)
        const body = await res.json()
        if (!cancelled) setOrgId(res.ok ? (body.data ?? body)?.orgId : undefined)
      } catch { if (!cancelled) setOrgId(undefined) }
    })()
    return () => { cancelled = true }
  }, [propertyId])

  const load = useCallback(async () => {
    if (!propertyId) return
    setLoading(true)
    try {
      const qs = new URLSearchParams({ propertyId, from: range.from, to: range.to })
      for (const [key, val] of Object.entries(segmentToParams(seg))) qs.set(key, val)
      const res = await fetch(`/api/v1/analytics/audience?${qs}`)
      const body = await res.json()
      setData(res.ok ? (body.data ?? body) : null)
    } catch { setData(null) } finally { setLoading(false) }
  }, [propertyId, range, seg])

  useEffect(() => { load() }, [load])

  const v = data?.visitors
  const e = data?.engagement

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <AnalyticsNav active="audience" propertyId={propertyId} />
      <h1 className="text-xl font-headline font-bold text-on-surface">Audience</h1>

      <div className="pib-card p-4 space-y-3">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} />
        {propertyId && <DateRangePicker value={range} onChange={setRange} />}
        {propertyId && <SegmentFilter value={seg} onChange={setSeg} orgId={orgId} />}
      </div>

      {!propertyId && (
        <div className="pib-card p-8 text-center text-on-surface-variant text-sm">
          Select a client and property to see audience insights.
        </div>
      )}

      {propertyId && loading && <div className="pib-skeleton h-24 rounded-lg" />}

      {propertyId && v && e && data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="New Visitors" value={v.new.toLocaleString()} accent />
            <KpiCard label="Returning Visitors" value={v.returning.toLocaleString()} />
            <KpiCard label="Avg Session" value={fmtDuration(e.avgDurationSec)} />
            <KpiCard label="Pages / Session" value={e.pagesPerSession} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="pib-card p-4">
              <h2 className="text-sm font-label font-semibold text-on-surface mb-3">New vs returning</h2>
              <DonutChart data={[{ label: 'New', count: v.new }, { label: 'Returning', count: v.returning }]} />
            </div>
            <div className="pib-card p-4">
              <h2 className="text-sm font-label font-semibold text-on-surface mb-3">Devices</h2>
              <DonutChart data={data.devices} />
            </div>
            <div className="pib-card p-4">
              <h2 className="text-sm font-label font-semibold text-on-surface mb-3">Browsers</h2>
              <DonutChart data={data.browsers} />
            </div>
            <div className="pib-card p-4">
              <h2 className="text-sm font-label font-semibold text-on-surface mb-3">Operating systems</h2>
              <DonutChart data={data.operatingSystems} />
            </div>
          </div>

          <div>
            <h2 className="text-sm font-label font-semibold text-on-surface mb-2">Top countries</h2>
            <SimpleTable
              columns={[{ key: 'label', label: 'Country' }, { key: 'count', label: 'Visitors', align: 'right' }]}
              rows={data.countries}
              empty="No country data in this range."
            />
          </div>

          <div>
            <h2 className="text-sm font-label font-semibold text-on-surface mb-2">Acquisition by week</h2>
            <SimpleTable
              columns={[{ key: 'week', label: 'Week' }, { key: 'newVisitors', label: 'New Visitors', align: 'right' }]}
              rows={data.cohorts}
              empty="No cohort data in this range."
            />
          </div>
        </>
      )}
    </div>
  )
}
