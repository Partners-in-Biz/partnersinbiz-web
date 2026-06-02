'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AnalyticsNav } from '@/components/admin/AnalyticsNav'
import { AnalyticsPropertyPicker } from '@/components/admin/AnalyticsPropertyPicker'

interface AnalyticsEvent {
  id: string
  event: string
  distinctId: string
  sessionId: string
  propertyId: string
  pageUrl: string | null
  country: string | null
  device: string | null
  serverTime: unknown
  properties: Record<string, unknown>
}

function formatTs(ts: unknown): string {
  if (!ts) return '—'
  const source = ts as { _seconds?: number; seconds?: number }
  const seconds = source._seconds ?? source.seconds
  const d = typeof seconds === 'number' ? new Date(seconds * 1000) : new Date(ts as string)
  return d.toLocaleString()
}

export default function AnalyticsEventsPage() {
  const router = useRouter()
  const sp = useSearchParams()
  const initialPid = sp?.get('propertyId') ?? ''
  const [events, setEvents] = useState<AnalyticsEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [propertyId, setPropertyId] = useState(initialPid)
  const [eventFilter, setEventFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  async function fetchEvents() {
    if (!propertyId.trim()) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ propertyId: propertyId.trim() })
      if (eventFilter) params.set('event', eventFilter)
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      const res = await fetch(`/api/v1/analytics/events?${params}`)
      if (!res.ok) throw new Error('Failed')
      const body = await res.json()
      setEvents(body.data)
    } catch {
      setEvents([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <AnalyticsNav active="events" propertyId={propertyId} />
      <h1 className="text-xl font-headline font-bold text-on-surface">Events</h1>

      <div className="pib-card p-4 space-y-3">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} />
        <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-on-surface-variant font-label block mb-1">Event name</label>
          <input
            type="text"
            value={eventFilter}
            onChange={e => setEventFilter(e.target.value)}
            placeholder="test_started"
            className="pib-input text-sm w-40"
          />
        </div>
        <div>
          <label className="text-xs text-on-surface-variant font-label block mb-1">From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="pib-input text-sm" />
        </div>
        <div>
          <label className="text-xs text-on-surface-variant font-label block mb-1">To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="pib-input text-sm" />
        </div>
        <button onClick={fetchEvents} disabled={!propertyId || loading} className="pib-btn-primary text-sm font-label">
          {loading ? 'Loading…' : 'Search'}
        </button>
        </div>
      </div>

      {events.length > 0 && (
        <div className="pib-card overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-outline-variant)]">
                {['Time', 'Event', 'User', 'Session', 'Page', 'Device', 'Country'].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-on-surface-variant font-label">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map(ev => (
                <tr
                  key={ev.id}
                  onClick={() => router.push(`/admin/analytics/sessions/${ev.sessionId}`)}
                  className="border-b border-[var(--color-outline-variant)] hover:bg-[var(--color-surface-container)] cursor-pointer"
                >
                  <td className="px-3 py-2 text-on-surface-variant">{formatTs(ev.serverTime)}</td>
                  <td className="px-3 py-2 font-mono text-on-surface">{ev.event}</td>
                  <td className="px-3 py-2 text-on-surface-variant font-mono">{ev.distinctId.slice(0, 12)}…</td>
                  <td className="px-3 py-2 text-on-surface-variant font-mono">{ev.sessionId.slice(0, 8)}…</td>
                  <td className="px-3 py-2 text-on-surface-variant">{ev.pageUrl ? new URL(ev.pageUrl).pathname : '—'}</td>
                  <td className="px-3 py-2 text-on-surface-variant">{ev.device ?? '—'}</td>
                  <td className="px-3 py-2 text-on-surface-variant">{ev.country ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && events.length === 0 && propertyId && (
        <div className="pib-card p-8 text-center text-on-surface-variant text-sm">No events found.</div>
      )}
    </div>
  )
}
