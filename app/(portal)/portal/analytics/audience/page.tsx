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
import { Icon } from '@/components/studio'
import { PageHeader, EmptyState } from '@/components/ui/AppFoundation'

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
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6" data-module-accent="violet">
      <AnalyticsNav active="audience" propertyId={propertyId} />
      <PageHeader
        eyebrow="Analytics · Audience"
        title="Audience."
      />

      <div className="st-panel space-y-4">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} />
        {propertyId && <DateRangePicker value={range} onChange={setRange} />}
        {propertyId && <SegmentFilter value={seg} onChange={setSeg} orgId={orgId} />}
      </div>

      {!propertyId && (
        <EmptyState title="Select a client and property to see audience insights." />
      )}

      {propertyId && loading && <div className="pib-skeleton h-24" />}

      {propertyId && v && e && data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label="New Visitors" value={v.new.toLocaleString()} accent />
            <KpiCard label="Returning Visitors" value={v.returning.toLocaleString()} />
            <KpiCard label="Avg Session" value={fmtDuration(e.avgDurationSec)} />
            <KpiCard label="Pages / Session" value={e.pagesPerSession} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="st-panel">
              <div className="mb-3 flex items-center gap-3">
                <Icon name="group_add" />
                <h2 className="pib-label mb-0">New vs returning</h2>
              </div>
              <DonutChart data={[{ label: 'New', count: v.new }, { label: 'Returning', count: v.returning }]} />
            </div>
            <div className="st-panel">
              <div className="mb-3 flex items-center gap-3">
                <Icon name="devices" />
                <h2 className="pib-label mb-0">Devices</h2>
              </div>
              <DonutChart data={data.devices} />
            </div>
            <div className="st-panel">
              <div className="mb-3 flex items-center gap-3">
                <Icon name="public" />
                <h2 className="pib-label mb-0">Browsers</h2>
              </div>
              <DonutChart data={data.browsers} />
            </div>
            <div className="st-panel">
              <div className="mb-3 flex items-center gap-3">
                <Icon name="memory" />
                <h2 className="pib-label mb-0">Operating systems</h2>
              </div>
              <DonutChart data={data.operatingSystems} />
            </div>
          </div>

          <div>
            <h2 className="pib-label mb-2">Top countries</h2>
            <SimpleTable
              columns={[{ key: 'label', label: 'Country' }, { key: 'count', label: 'Visitors', align: 'right' }]}
              rows={data.countries}
              empty="No country data in this range."
            />
          </div>

          <div>
            <h2 className="pib-label mb-2">Acquisition by week</h2>
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
