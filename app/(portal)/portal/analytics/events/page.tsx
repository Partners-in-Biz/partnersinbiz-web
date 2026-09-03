'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AnalyticsNav } from '@/components/admin/AnalyticsNav'
import { AnalyticsPropertyPicker } from '@/components/admin/AnalyticsPropertyPicker'
import { FeatureGate } from '@/components/paywall/FeatureGate'
import { Icon } from '@/components/studio'
import { PageHeader, EmptyState } from '@/components/ui/AppFoundation'

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
  if (!ts) return ' - '
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
    <FeatureGate feature="analytics">
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6" data-module-accent="violet">
      <AnalyticsNav active="events" propertyId={propertyId} />
      <PageHeader
        eyebrow="Analytics · Events"
        title="Events."
      />

      <div className="st-panel space-y-4">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} />
        <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="pib-label mb-1">Event name</label>
          <input name="text"
            type="text"
            value={eventFilter}
            onChange={e => setEventFilter(e.target.value)}
            placeholder="test_started"
            className="pib-input text-sm w-40"
          />
        </div>
        <div>
          <label className="pib-label mb-1">From</label>
          <input name="date" type="date" value={from} onChange={e => setFrom(e.target.value)} className="pib-input text-sm" />
        </div>
        <div>
          <label className="pib-label mb-1">To</label>
          <input name="date" type="date" value={to} onChange={e => setTo(e.target.value)} className="pib-input text-sm" />
        </div>
        <button name="page-action-11" onClick={fetchEvents} disabled={!propertyId || loading} className="st-btn st-btn--primary text-sm">
          {loading ? 'Loading…' : 'Search'}
        </button>
        </div>
      </div>

      {events.length > 0 && (
        <div className="pib-surface pib-surface-table overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-pib-line)]">
                {['Time', 'Event', 'User', 'Session', 'Page', 'Device', 'Country'].map(h => (
                  <th key={h} className="text-left px-3 py-2 pib-label mb-0">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map(ev => (
                <tr
                  key={ev.id}
                  onClick={() => router.push(`/portal/analytics/sessions/${ev.sessionId}`)}
                  className="border-b border-[var(--color-pib-line)] hover:bg-[var(--color-row-hover)] cursor-pointer"
                >
                  <td className="px-3 py-2 text-[var(--color-pib-text-muted)]">{formatTs(ev.serverTime)}</td>
                  <td className="px-3 py-2 font-mono text-[var(--color-pib-text)]">{ev.event}</td>
                  <td className="px-3 py-2 text-[var(--color-pib-text-muted)] font-mono">{ev.distinctId.slice(0, 12)}…</td>
                  <td className="px-3 py-2 text-[var(--color-pib-text-muted)] font-mono">{ev.sessionId.slice(0, 8)}…</td>
                  <td className="px-3 py-2 text-[var(--color-pib-text-muted)]">{ev.pageUrl ? new URL(ev.pageUrl).pathname : ' - '}</td>
                  <td className="px-3 py-2 text-[var(--color-pib-text-muted)]">{ev.device ?? ' - '}</td>
                  <td className="px-3 py-2 text-[var(--color-pib-text-muted)]">{ev.country ?? ' - '}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && events.length === 0 && propertyId && (
        <EmptyState title="No events found." />
      )}
    </div>
    </FeatureGate>
  )
}
