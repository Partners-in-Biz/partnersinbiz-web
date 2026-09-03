'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnalyticsNav } from '@/components/admin/AnalyticsNav'
import { AnalyticsPropertyPicker } from '@/components/admin/AnalyticsPropertyPicker'
import { Icon, Status } from '@/components/studio'
import { EmptyState, PageHeader } from '@/components/ui/AppFoundation'

interface LiveEvent {
  id: string
  event: string
  distinctId: string
  country: string | null
  device: string | null
  pageUrl: string | null
  properties: Record<string, unknown>
  serverTime: unknown
}

const EVENT_COLORS: Record<string, string> = {
  '$pageview': 'text-[var(--sc-ink-soft)]',
  '$identify': 'text-[var(--sc-ink-soft)]',
  'signup': 'text-[var(--color-pib-success)]',
  'signup_completed': 'text-[var(--color-pib-success)]',
}
const defaultColor = 'text-[var(--color-pib-accent-hover)]'

function formatLiveTime(value: unknown): string {
  if (!value) return 'now'
  const source = value as { _seconds?: number; seconds?: number; toDate?: () => Date }
  if (typeof source.toDate === 'function') return source.toDate().toLocaleTimeString()
  const seconds = source._seconds ?? source.seconds
  return typeof seconds === 'number' ? new Date(seconds * 1000).toLocaleTimeString() : 'now'
}

export default function LivePage() {
  const sp = useSearchParams()
  const initialPid = sp?.get('propertyId') ?? ''
  const [propertyId, setPropertyId] = useState(initialPid)
  const [active, setActive] = useState(false)
  const [events, setEvents] = useState<LiveEvent[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function poll(pid: string) {
    const res = await fetch(`/api/v1/analytics/live?propertyId=${encodeURIComponent(pid)}`)
    if (!res.ok) return
    const data = await res.json()
    setEvents(data.events ?? [])
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
    <div className="space-y-6 p-4 md:p-6" data-module-accent="violet">
      <AnalyticsNav active="live" propertyId={propertyId} />
      <PageHeader
        eyebrow="Analytics · Live"
        title="Live."
        actions={active ? <Status tone="success">Live, last 5 min</Status> : undefined}
      />

      <div className="st-panel space-y-4">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} disabled={active} />
        <div className="flex justify-end">
          {!active
            ? <button className="st-btn st-btn--primary" onClick={start} disabled={!propertyId}>Start</button>
            : <button className="st-btn st-btn--secondary" onClick={stop}>Stop</button>
          }
        </div>
      </div>

      {events.length === 0 && active && (
        <EmptyState title="Waiting for events in the last 5 minutes." />
      )}

      {events.length > 0 && (
        <div className="pib-surface pib-surface-list divide-y divide-[var(--color-pib-line)]">
          {events.map((ev, i) => (
            <div key={ev.id ?? i} className="p-3 flex items-start gap-4 text-sm hover:bg-[var(--color-row-hover)]">
              <span className={`font-mono text-xs whitespace-nowrap pt-0.5 ${EVENT_COLORS[ev.event] ?? defaultColor}`}>
                {ev.event}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[var(--color-pib-text-muted)] text-xs truncate">
                  {ev.pageUrl ?? (ev.properties?.['$current_url'] as string) ?? ' - '}
                </p>
                <p className="text-[var(--color-pib-text-muted)] text-xs">
                  {ev.distinctId?.slice(0, 12)}… · {ev.device ?? '?'} · {ev.country ?? '?'}
                </p>
              </div>
              <span className="text-[var(--color-pib-text-muted)] text-xs whitespace-nowrap">
                {formatLiveTime(ev.serverTime)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
