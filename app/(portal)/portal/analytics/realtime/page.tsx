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
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6" data-module-accent="violet">
      <AnalyticsNav active="realtime" propertyId={propertyId} />
      <header>
        <p className="eyebrow">Analytics · Realtime</p>
        <div className="mt-2 flex items-center gap-4">
          <h1 className="pib-page-title">Realtime</h1>
          {active && (
            <span className="pib-pill pib-pill-success">
              <span className="pib-status-dot pib-status-dot-success animate-pulse" />
              Live{data ? ` — last ${data.activeWindowMin} min` : ''}
            </span>
          )}
        </div>
      </header>

      <div className="pib-card space-y-4">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} disabled={active} />
        <div className="flex justify-end">
          {!active
            ? <button className="btn-pib-primary text-sm" onClick={start} disabled={!propertyId}>Start</button>
            : <button className="btn-pib-secondary text-sm" onClick={stop}>Stop</button>
          }
        </div>
      </div>

      {!propertyId && (
        <div className="pib-empty-state">
          <span aria-hidden="true" className="material-symbols-outlined pib-empty-state-icon">monitoring</span>
          <p className="pib-empty-state-description">Select a client and property to see realtime activity.</p>
        </div>
      )}

      {propertyId && data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="pib-stat-card">
              <p className="pib-label flex items-center gap-1.5">
                <span className="pib-status-dot pib-status-dot-success animate-pulse" />
                Active visitors
              </p>
              <p className="text-3xl font-semibold mt-1 text-[var(--color-pib-text)]">{data.activeVisitors.toLocaleString()}</p>
              <p className="text-xs text-[var(--color-pib-text-muted)] mt-0.5">last {data.activeWindowMin} min</p>
            </div>
          </div>

          <div className="pib-card">
            <h2 className="pib-label mb-3">Last {data.activeWindowMin} minutes</h2>
            <LineSeries data={data.trend} xKey="minute" yKey="visitors" label="Visitors" />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div>
              <h2 className="pib-label mb-2">Top pages</h2>
              <SimpleTable
                columns={[{ key: 'label', label: 'Page' }, { key: 'count', label: 'Active', align: 'right' }]}
                rows={data.topPages}
                empty="No active pages right now."
              />
            </div>
            <div>
              <h2 className="pib-label mb-2">Top sources</h2>
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
