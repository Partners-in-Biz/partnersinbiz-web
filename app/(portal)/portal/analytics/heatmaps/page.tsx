'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnalyticsNav } from '@/components/admin/AnalyticsNav'
import { AnalyticsPropertyPicker } from '@/components/admin/AnalyticsPropertyPicker'
import { DateRangePicker, defaultRange, type DateRangeValue } from '@/components/analytics/DateRangePicker'
import { BarSeries } from '@/components/analytics/Charts'
import { KpiCard, SimpleTable } from '@/components/analytics/Primitives'
import { Icon } from '@/components/studio'
import { PageHeader, EmptyState } from '@/components/ui/AppFoundation'

interface HeatmapData {
  mode: string
  note: string
  urls: Array<{ url: string; views: number }>
  clicks: Array<{ selector: string; count: number }>
  clickTotal: number
  scrollBuckets: Array<{ band: string; count: number }>
  scrollSamples: number
}

type Device = '' | 'desktop' | 'mobile'

export default function HeatmapsPage() {
  const sp = useSearchParams()
  const [propertyId, setPropertyId] = useState(sp?.get('propertyId') ?? '')
  const [range, setRange] = useState<DateRangeValue>(defaultRange(30))
  const [selectedUrl, setSelectedUrl] = useState('')
  const [device, setDevice] = useState<Device>('')
  const [data, setData] = useState<HeatmapData | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!propertyId) return
    setLoading(true)
    try {
      const qs = new URLSearchParams({ propertyId, from: range.from, to: range.to })
      if (selectedUrl) qs.set('url', selectedUrl)
      if (device) qs.set('device', device)
      const res = await fetch(`/api/v1/analytics/heatmaps?${qs}`)
      const body = await res.json()
      setData(res.ok ? (body.data ?? body) : null)
    } catch { setData(null) } finally { setLoading(false) }
  }, [propertyId, range, selectedUrl, device])

  useEffect(() => { load() }, [load])

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6" data-module-accent="violet">
      <AnalyticsNav active="heatmaps" propertyId={propertyId} />
      <PageHeader
        eyebrow="Analytics · Heatmaps"
        title="Heatmaps."
      />

      <div className="st-panel space-y-4">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} />
        {propertyId && (
          <>
            <DateRangePicker value={range} onChange={setRange} />
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="pib-label">Page URL</label>
                <select name="page-select-19"
                  value={selectedUrl}
                  onChange={e => setSelectedUrl(e.target.value)}
                  className="pib-select text-xs w-72"
                >
                  <option value="">All pages</option>
                  {(data?.urls ?? []).map(u => (
                    <option key={u.url} value={u.url}>{u.url} ({u.views})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="pib-label">Device</label>
                <div className="pib-tabs pib-tabs-segmented" role="tablist" aria-label="Device">
                  {([['', 'All'], ['desktop', 'Desktop'], ['mobile', 'Mobile']] as Array<[Device, string]>).map(([val, lbl]) => (
                    <button name="page-action-20"
                      key={val || 'all'}
                      type="button"
                      role="tab"
                      aria-selected={device === val}
                      onClick={() => setDevice(val)}
                      className={`pib-tab ${device === val ? 'pib-tab-active' : ''}`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {!propertyId && (
        <EmptyState title="Select a client and property to see heatmap data." />
      )}

      {propertyId && loading && <div className="pib-skeleton h-24" />}

      {propertyId && !loading && data && (
        <>
          {data.note && (
            <div className="st-panel border-l-2 border-l-[var(--sc-ink-soft)]">
              <p className="text-xs text-[var(--color-pib-text-muted)]">{data.note}</p>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label="Total clicks" value={data.clickTotal.toLocaleString()} accent />
            <KpiCard label="Scroll samples" value={data.scrollSamples.toLocaleString()} />
          </div>

          <div className="st-panel">
            <div className="mb-3 flex items-center gap-3">
              <Icon name="ads_click" />
              <h2 className="pib-label mb-0">Element clicks</h2>
            </div>
            <BarSeries data={data.clicks} xKey="selector" yKey="count" label="Clicks" />
          </div>

          <div>
            <h2 className="pib-label mb-2">Element click counts</h2>
            <SimpleTable
              columns={[{ key: 'selector', label: 'Element' }, { key: 'count', label: 'Clicks', align: 'right' }]}
              rows={data.clicks}
              empty="No click data in this range."
            />
          </div>

          <div className="st-panel">
            <div className="mb-3 flex items-center gap-3">
              <Icon name="swipe_vertical" />
              <h2 className="pib-label mb-0">Scroll depth</h2>
            </div>
            <BarSeries data={data.scrollBuckets} xKey="band" yKey="count" label="Sessions" />
          </div>
        </>
      )}
    </div>
  )
}
