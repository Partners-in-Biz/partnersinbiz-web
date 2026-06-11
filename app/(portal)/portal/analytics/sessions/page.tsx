'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AnalyticsNav } from '@/components/admin/AnalyticsNav'
import { AnalyticsPropertyPicker } from '@/components/admin/AnalyticsPropertyPicker'

interface Session {
  id: string
  distinctId: string
  eventCount: number
  pageCount: number
  device: string | null
  country: string | null
  utmSource: string | null
  startedAt: unknown
  lastActivityAt: unknown
}

function timestampSeconds(ts: unknown): number | null {
  if (!ts) return null
  const source = ts as { _seconds?: number; seconds?: number }
  return source._seconds ?? source.seconds ?? null
}

function formatTs(ts: unknown): string {
  if (!ts) return '—'
  const seconds = timestampSeconds(ts)
  const d = typeof seconds === 'number' ? new Date(seconds * 1000) : new Date(ts as string)
  return d.toLocaleString()
}

function durationLabel(start: unknown, end: unknown): string {
  if (!start || !end) return '—'
  const s = timestampSeconds(start) ?? 0
  const e = timestampSeconds(end) ?? 0
  const diff = e - s
  if (diff < 60) return `${diff}s`
  return `${Math.floor(diff / 60)}m ${diff % 60}s`
}

export default function SessionsPage() {
  const router = useRouter()
  const sp = useSearchParams()
  const initialPid = sp?.get('propertyId') ?? ''
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(false)
  const [propertyId, setPropertyId] = useState(initialPid)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  async function fetchSessions() {
    if (!propertyId.trim()) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ propertyId: propertyId.trim() })
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      const res = await fetch(`/api/v1/analytics/sessions?${params}`)
      if (!res.ok) throw new Error('Failed')
      const body = await res.json()
      setSessions(body.data)
    } catch {
      setSessions([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <AnalyticsNav active="sessions" propertyId={propertyId} />
      <h1 className="text-xl font-headline font-bold text-on-surface">Sessions</h1>

      <div className="pib-card p-4 space-y-3">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} />
        <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-on-surface-variant font-label block mb-1">From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="pib-input text-sm" />
        </div>
        <div>
          <label className="text-xs text-on-surface-variant font-label block mb-1">To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="pib-input text-sm" />
        </div>
        <button onClick={fetchSessions} disabled={!propertyId || loading} className="pib-btn-primary text-sm font-label">
          {loading ? 'Loading…' : 'Search'}
        </button>
        </div>
      </div>

      {sessions.length > 0 && (
        <div className="pib-card overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-outline-variant)]">
                {['Started', 'User', 'Duration', 'Events', 'Pages', 'Device', 'Country', 'UTM Source'].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-on-surface-variant font-label">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.map(s => (
                <tr
                  key={s.id}
                  onClick={() => router.push(`/portal/analytics/sessions/${s.id}`)}
                  className="border-b border-[var(--color-outline-variant)] hover:bg-[var(--color-surface-container)] cursor-pointer"
                >
                  <td className="px-3 py-2 text-on-surface-variant">{formatTs(s.startedAt)}</td>
                  <td className="px-3 py-2 font-mono text-on-surface">{s.distinctId.slice(0, 12)}…</td>
                  <td className="px-3 py-2 text-on-surface-variant">{durationLabel(s.startedAt, s.lastActivityAt)}</td>
                  <td className="px-3 py-2 text-on-surface">{s.eventCount}</td>
                  <td className="px-3 py-2 text-on-surface-variant">{s.pageCount}</td>
                  <td className="px-3 py-2 text-on-surface-variant">{s.device ?? '—'}</td>
                  <td className="px-3 py-2 text-on-surface-variant">{s.country ?? '—'}</td>
                  <td className="px-3 py-2 text-on-surface-variant">{s.utmSource ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && sessions.length === 0 && propertyId && (
        <div className="pib-card p-8 text-center text-on-surface-variant text-sm">No sessions found.</div>
      )}
    </div>
  )
}
