'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

interface SessionDetail {
  session: {
    id: string
    distinctId: string
    userId: string | null
    eventCount: number
    pageCount: number
    device: string | null
    country: string | null
    utmSource: string | null
    utmMedium: string | null
    utmCampaign: string | null
    landingUrl: string | null
    startedAt: any
    lastActivityAt: any
  }
  events: Array<{
    id: string
    event: string
    properties: Record<string, unknown>
    pageUrl: string | null
    serverTime: any
  }>
}

function formatTs(ts: any): string {
  if (!ts) return '—'
  const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts)
  return d.toLocaleString()
}

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [data, setData] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/v1/analytics/sessions/${id}`)
      .then(r => { if (!r.ok) throw new Error('not found'); return r.json() })
      .then(body => { setData(body.data); setLoading(false) })
      .catch(() => { setLoading(false); router.push('/portal/analytics/sessions') })
  }, [id, router])

  if (loading) return <div className="pib-skeleton h-40 rounded-xl max-w-4xl mx-auto" />
  if (!data) return null

  const { session, events } = data

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/portal/analytics/sessions')} className="text-on-surface-variant hover:text-on-surface text-sm">
          ← Sessions
        </button>
        <span className="text-on-surface-variant">/</span>
        <h1 className="text-lg font-headline font-bold text-on-surface font-mono">{id.slice(0, 16)}…</h1>
      </div>

      <div className="pib-card p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
        {[
          ['User', session.distinctId.slice(0, 16) + '…'],
          ['Events', session.eventCount],
          ['Pages', session.pageCount],
          ['Device', session.device ?? '—'],
          ['Country', session.country ?? '—'],
          ['UTM Source', session.utmSource ?? '—'],
          ['Started', formatTs(session.startedAt)],
          ['Last Active', formatTs(session.lastActivityAt)],
        ].map(([label, value]) => (
          <div key={label as string}>
            <p className="text-xs text-on-surface-variant font-label mb-0.5">{label}</p>
            <p className="text-on-surface font-medium text-xs">{value}</p>
          </div>
        ))}
      </div>

      <div className="pib-card divide-y divide-[var(--color-outline-variant)]">
        <div className="px-4 py-2 text-xs font-label text-on-surface-variant">
          Event Timeline ({events.length})
        </div>
        {events.map(ev => (
          <div key={ev.id} className="px-4 py-3 flex items-start gap-4 text-xs">
            <span className="text-on-surface-variant shrink-0 w-40">{formatTs(ev.serverTime)}</span>
            <span className="font-mono text-on-surface font-medium">{ev.event}</span>
            {ev.pageUrl && (
              <span className="text-on-surface-variant truncate max-w-xs">
                {new URL(ev.pageUrl).pathname}
              </span>
            )}
            {Object.keys(ev.properties).length > 0 && (
              <span className="text-on-surface-variant truncate max-w-xs font-mono">
                {JSON.stringify(ev.properties).slice(0, 80)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
