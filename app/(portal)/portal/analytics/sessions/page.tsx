'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AnalyticsNav } from '@/components/admin/AnalyticsNav'
import { AnalyticsPropertyPicker } from '@/components/admin/AnalyticsPropertyPicker'
import { Icon } from '@/components/studio'
import { PageHeader, EmptyState } from '@/components/ui/AppFoundation'

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
  if (!ts) return ' - '
  const seconds = timestampSeconds(ts)
  const d = typeof seconds === 'number' ? new Date(seconds * 1000) : new Date(ts as string)
  return d.toLocaleString()
}

function durationLabel(start: unknown, end: unknown): string {
  if (!start || !end) return ' - '
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
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6" data-module-accent="violet">
      <AnalyticsNav active="sessions" propertyId={propertyId} />
      <PageHeader
        eyebrow="Analytics · Sessions"
        title="Sessions."
      />

      <div className="st-panel space-y-4">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} />
        <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="pib-label mb-1">From</label>
          <input name="date" type="date" value={from} onChange={e => setFrom(e.target.value)} className="pib-input text-sm" />
        </div>
        <div>
          <label className="pib-label mb-1">To</label>
          <input name="date" type="date" value={to} onChange={e => setTo(e.target.value)} className="pib-input text-sm" />
        </div>
        <button name="page-action-34" onClick={fetchSessions} disabled={!propertyId || loading} className="st-btn st-btn--primary text-sm">
          {loading ? 'Loading…' : 'Search'}
        </button>
        </div>
      </div>

      {sessions.length > 0 && (
        <div className="pib-surface pib-surface-table overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-pib-line)]">
                {['Started', 'User', 'Duration', 'Events', 'Pages', 'Device', 'Country', 'UTM Source'].map(h => (
                  <th key={h} className="text-left px-3 py-2 pib-label mb-0">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.map(s => (
                <tr
                  key={s.id}
                  onClick={() => router.push(`/portal/analytics/sessions/${s.id}`)}
                  className="border-b border-[var(--color-pib-line)] hover:bg-[var(--color-row-hover)] cursor-pointer"
                >
                  <td className="px-3 py-2 text-[var(--color-pib-text-muted)]">{formatTs(s.startedAt)}</td>
                  <td className="px-3 py-2 font-mono text-[var(--color-pib-text)]">{s.distinctId.slice(0, 12)}…</td>
                  <td className="px-3 py-2 text-[var(--color-pib-text-muted)]">{durationLabel(s.startedAt, s.lastActivityAt)}</td>
                  <td className="px-3 py-2 text-[var(--color-pib-text)]">{s.eventCount}</td>
                  <td className="px-3 py-2 text-[var(--color-pib-text-muted)]">{s.pageCount}</td>
                  <td className="px-3 py-2 text-[var(--color-pib-text-muted)]">{s.device ?? ' - '}</td>
                  <td className="px-3 py-2 text-[var(--color-pib-text-muted)]">{s.country ?? ' - '}</td>
                  <td className="px-3 py-2 text-[var(--color-pib-text-muted)]">{s.utmSource ?? ' - '}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && sessions.length === 0 && propertyId && (
        <EmptyState title="No sessions found." />
      )}
    </div>
  )
}
