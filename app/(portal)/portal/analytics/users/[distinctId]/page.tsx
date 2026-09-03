'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { Icon, ButtonLink } from '@/components/studio'
import { EmptyState, PageHeader } from '@/components/ui/AppFoundation'

interface EventRow {
  id: string
  event: string
  timestamp: unknown
  serverTime: unknown
  properties: Record<string, unknown>
  pageUrl: string | null
  device: string | null
  country: string | null
}

export default function UserTimelinePage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const distinctId = decodeURIComponent(params.distinctId as string)
  const propertyId = searchParams.get('propertyId') ?? ''

  const [events, setEvents] = useState<EventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!propertyId) return
    fetch(`/api/v1/analytics/users/${encodeURIComponent(distinctId)}?propertyId=${encodeURIComponent(propertyId)}`)
      .then(r => { if (r.status === 404) { setNotFound(true); return null } return r.json() })
      .then(data => { if (data) setEvents(data.events ?? []) })
      .finally(() => setLoading(false))
  }, [distinctId, propertyId])

  if (loading) return (
    <div className="p-6 space-y-3">
      {[...Array(8)].map((_, i) => <div key={i} className="pib-skeleton h-12 rounded" />)}
    </div>
  )

  if (notFound) return (
    <div className="p-6">
      <ButtonLink href="/portal/analytics/users" variant="secondary" size="sm" className="mb-6">Back</ButtonLink>
      <EmptyState title="User not found." />
    </div>
  )

  return (
    <div className="space-y-6 p-4 md:p-6" data-module-accent="violet">
      <PageHeader
        eyebrow="Analytics · Users"
        title="User timeline."
        description={distinctId}
        actions={(
          <ButtonLink href="/portal/analytics/users" variant="secondary" size="sm">Users</ButtonLink>
        )}
      />

      <div className="pib-surface pib-surface-table overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] text-xs uppercase tracking-widest">
              <th className="text-left p-3">Event</th>
              <th className="text-left p-3">Page</th>
              <th className="text-left p-3">Device</th>
              <th className="text-left p-3">Country</th>
              <th className="text-left p-3">Time</th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev, i) => (
              <tr key={ev.id ?? i} className="border-b border-[var(--color-pib-line)] hover:bg-[var(--color-row-hover)]">
                <td className="p-3 font-mono text-xs text-[var(--color-pib-accent-hover)]">{ev.event}</td>
                <td className="p-3 text-[var(--color-pib-text-muted)] text-xs truncate max-w-[200px]">
                  {ev.pageUrl ?? (ev.properties?.['$current_url'] as string) ?? ' - '}
                </td>
                <td className="p-3 text-[var(--color-pib-text-muted)]">{ev.device ?? ' - '}</td>
                <td className="p-3 text-[var(--color-pib-text-muted)]">{ev.country ?? ' - '}</td>
                <td className="p-3 text-[var(--color-pib-text-muted)] text-xs">
                  {(ev.serverTime as any)?.toDate
                    ? (ev.serverTime as any).toDate().toLocaleString()
                    : new Date(((ev.timestamp as any)?._seconds ?? 0) * 1000).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
