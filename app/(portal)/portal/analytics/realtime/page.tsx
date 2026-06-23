'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnalyticsNav } from '@/components/admin/AnalyticsNav'
import { AnalyticsPropertyPicker } from '@/components/admin/AnalyticsPropertyPicker'
import { LineSeries } from '@/components/analytics/Charts'
import { KpiCard, SimpleTable } from '@/components/analytics/Primitives'

interface RealtimeData {
  activeVisitors: number
  activeWindowMin: number
  topPages: Array<{ label: string; count: number }>
  topSources: Array<{ label: string; count: number }>
  trend: Array<{ minute: string; events: number; visitors: number }>
}

export default function RealtimePage() {
  const sp = useSearchParams()
  const initialPid = sp?.get('propertyId') ?? ''
  const [propertyId, setPropertyId] = useState(initialPid)
  const [active, setActive] = useState(false)
  const [data, setData] = useState<RealtimeData | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function poll(pid: string) {
    try {
      const res = await fetch(`/api/v1/analytics/realtime?propertyId=${encodeURIComponent(pid)}`)
      if (!res.ok) return
      const body = await res.json()
      setData(body.data ?? body)
    } catch { /* keep last data */ }
  }

  function start() {
    if (!propertyId) return
    setActive(true)
    poll(propertyId)
    intervalRef.current = setInterval(() => poll(propertyId), 5000)
  }

  function stop() {
    setActive(false)
    if (intervalRef.current) clearInterval(intervalRef.current)
  }

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current) }, [])

  useEffect(() => {
    if (initialPid) {
      setActive(true)
      poll(initialPid)
      intervalRef.current = setInterval(() => poll(initialPid), 5000)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <AnalyticsNav active="realtime" propertyId={propertyId} />
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-headline font-bold text-on-surface">Realtime</h1>
        {active && (
          <span className="flex items-center gap-1.5 text-green-400 text-xs font-medium">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            Live{data ? ` — last ${data.activeWindowMin} min` : ''}
          </span>
        )}
      </div>

      <div className="pib-card p-4 space-y-3">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} disabled={active} />
        <div className="flex justify-end">
          {!active
            ? <button className="pib-btn-primary text-sm font-label" onClick={start} disabled={!propertyId}>Start</button>
            : <button className="pib-btn-secondary text-sm font-label" onClick={stop}>Stop</button>
          }
        </div>
      </div>

      {!propertyId && (
        <div className="pib-card p-8 text-center text-on-surface-variant text-sm">
          Select a client and property to see realtime activity.
        </div>
      )}

      {propertyId && data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="pib-card p-4">
              <p className="text-xs text-on-surface-variant font-label flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                Active visitors
              </p>
              <p className="text-3xl font-bold mt-1 text-amber-400">{data.activeVisitors.toLocaleString()}</p>
              <p className="text-xs text-on-surface-variant mt-0.5">last {data.activeWindowMin} min</p>
            </div>
          </div>

          <div className="pib-card p-4">
            <h2 className="text-sm font-label font-semibold text-on-surface mb-3">Last {data.activeWindowMin} minutes</h2>
            <LineSeries data={data.trend} xKey="minute" yKey="visitors" label="Visitors" />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div>
              <h2 className="text-sm font-label font-semibold text-on-surface mb-2">Top pages</h2>
              <SimpleTable
                columns={[{ key: 'label', label: 'Page' }, { key: 'count', label: 'Active', align: 'right' }]}
                rows={data.topPages}
                empty="No active pages right now."
              />
            </div>
            <div>
              <h2 className="text-sm font-label font-semibold text-on-surface mb-2">Top sources</h2>
              <SimpleTable
                columns={[{ key: 'label', label: 'Source' }, { key: 'count', label: 'Active', align: 'right' }]}
                rows={data.topSources}
                empty="No active sources right now."
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
