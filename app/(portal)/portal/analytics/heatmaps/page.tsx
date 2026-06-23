'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnalyticsNav } from '@/components/admin/AnalyticsNav'
import { AnalyticsPropertyPicker } from '@/components/admin/AnalyticsPropertyPicker'
import { DateRangePicker, defaultRange, type DateRangeValue } from '@/components/analytics/DateRangePicker'
import { BarSeries } from '@/components/analytics/Charts'
import { KpiCard, SimpleTable } from '@/components/analytics/Primitives'

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
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <AnalyticsNav active="heatmaps" propertyId={propertyId} />
      <h1 className="text-xl font-headline font-bold text-on-surface">Heatmaps</h1>

      <div className="pib-card p-4 space-y-3">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} />
        {propertyId && (
          <>
            <DateRangePicker value={range} onChange={setRange} />
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-wide text-on-surface-variant font-label block">Page URL</label>
                <select
                  value={selectedUrl}
                  onChange={e => setSelectedUrl(e.target.value)}
                  className="pib-input text-xs w-72"
                >
                  <option value="">All pages</option>
                  {(data?.urls ?? []).map(u => (
                    <option key={u.url} value={u.url}>{u.url} ({u.views})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wide text-on-surface-variant font-label block">Device</label>
                <div className="flex gap-1">
                  {([['', 'All'], ['desktop', 'Desktop'], ['mobile', 'Mobile']] as Array<[Device, string]>).map(([val, lbl]) => (
                    <button
                      key={val || 'all'}
                      type="button"
                      onClick={() => setDevice(val)}
                      className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                        device === val
                          ? 'bg-amber-400/20 text-amber-400'
                          : 'text-on-surface-variant hover:text-on-surface bg-[var(--color-surface-container)]'
                      }`}
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
        <div className="pib-card p-8 text-center text-on-surface-variant text-sm">
          Select a client and property to see heatmap data.
        </div>
      )}

      {propertyId && loading && <div className="pib-skeleton h-24 rounded-lg" />}

      {propertyId && !loading && data && (
        <>
          {data.note && (
            <div className="pib-card p-4 border-l-2 border-blue-400 bg-blue-400/5">
              <p className="text-xs text-on-surface-variant">{data.note}</p>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Total clicks" value={data.clickTotal.toLocaleString()} accent />
            <KpiCard label="Scroll samples" value={data.scrollSamples.toLocaleString()} />
          </div>

          <div className="pib-card p-4">
            <h2 className="text-sm font-label font-semibold text-on-surface mb-3">Element clicks</h2>
            <BarSeries data={data.clicks} xKey="selector" yKey="count" label="Clicks" />
          </div>

          <div>
            <h2 className="text-sm font-label font-semibold text-on-surface mb-2">Element click counts</h2>
            <SimpleTable
              columns={[{ key: 'selector', label: 'Element' }, { key: 'count', label: 'Clicks', align: 'right' }]}
              rows={data.clicks}
              empty="No click data in this range."
            />
          </div>

          <div className="pib-card p-4">
            <h2 className="text-sm font-label font-semibold text-on-surface mb-3">Scroll depth</h2>
            <BarSeries data={data.scrollBuckets} xKey="band" yKey="count" label="Sessions" />
          </div>
        </>
      )}
    </div>
  )
}
