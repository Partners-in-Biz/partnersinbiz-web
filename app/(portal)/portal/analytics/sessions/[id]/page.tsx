'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { PageHeader } from '@/components/ui/AppFoundation'
import { Button } from '@/components/studio'

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
  if (!ts) return ' - '
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

  if (loading) return <div className="pib-skeleton h-40 max-w-4xl mx-auto" />
  if (!data) return null

  const { session, events } = data

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6" data-module-accent="violet">
      <PageHeader
        eyebrow="Analytics · Session"
        title={`${id.slice(0, 16)}.`}
        actions={(
          <Button variant="ghost" size="sm" onClick={() => router.push('/portal/analytics/sessions')}>
            Sessions
          </Button>
        )}
      />

      <div className="st-panel grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
        {[
          ['User', session.distinctId.slice(0, 16) + '…'],
          ['Events', session.eventCount],
          ['Pages', session.pageCount],
          ['Device', session.device ?? ' - '],
          ['Country', session.country ?? ' - '],
          ['UTM Source', session.utmSource ?? ' - '],
          ['Started', formatTs(session.startedAt)],
          ['Last Active', formatTs(session.lastActivityAt)],
        ].map(([label, value]) => (
          <div key={label as string}>
            <p className="pib-label mb-0.5">{label}</p>
            <p className="text-[var(--color-pib-text)] font-medium text-xs">{value}</p>
          </div>
        ))}
      </div>

      <div className="pib-surface pib-surface-list divide-y divide-[var(--color-pib-line)]">
        <div className="px-4 py-2 pib-label mb-0">
          Event Timeline ({events.length})
        </div>
        {events.map(ev => (
          <div key={ev.id} className="px-4 py-3 flex items-start gap-4 text-xs hover:bg-[var(--color-row-hover)]">
            <span className="text-[var(--color-pib-text-muted)] shrink-0 w-40">{formatTs(ev.serverTime)}</span>
            <span className="font-mono text-[var(--color-pib-text)] font-medium">{ev.event}</span>
            {ev.pageUrl && (
              <span className="text-[var(--color-pib-text-muted)] truncate max-w-xs">
                {new URL(ev.pageUrl).pathname}
              </span>
            )}
            {Object.keys(ev.properties).length > 0 && (
              <span className="text-[var(--color-pib-text-muted)] truncate max-w-xs font-mono">
                {JSON.stringify(ev.properties).slice(0, 80)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
