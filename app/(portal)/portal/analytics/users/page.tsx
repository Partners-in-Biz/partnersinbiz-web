'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { AnalyticsNav } from '@/components/admin/AnalyticsNav'
import { AnalyticsPropertyPicker } from '@/components/admin/AnalyticsPropertyPicker'
import { Icon } from '@/components/studio'
import { PageHeader, EmptyState } from '@/components/ui/AppFoundation'

interface UserRow {
  distinctId: string
  userId: string | null
  firstSeen: string
  lastSeen: string
  eventCount: number
}

export default function AnalyticsUsersPage() {
  const sp = useSearchParams()
  const initialPid = sp?.get('propertyId') ?? ''
  const [propertyId, setPropertyId] = useState(initialPid)
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(false)

  async function load() {
    if (!propertyId) return
    setLoading(true)
    const res = await fetch(`/api/v1/analytics/users?propertyId=${encodeURIComponent(propertyId)}`)
    const data = await res.json()
    setUsers(data.users ?? [])
    setLoading(false)
  }

  return (
    <div className="space-y-6 p-4 md:p-6" data-module-accent="violet">
      <AnalyticsNav active="users" propertyId={propertyId} />
      <PageHeader
        eyebrow="Analytics · Users"
        title="Users."
      />

      <div className="st-panel space-y-4">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} />
        <div className="flex justify-end">
          <button className="st-btn st-btn--primary" onClick={load} disabled={!propertyId || loading}>
            {loading ? 'Loading…' : 'Load'}
          </button>
        </div>
      </div>

      {loading && (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <div key={i} className="pib-skeleton h-10" />)}
        </div>
      )}

      {!loading && users.length > 0 && (
        <div className="pib-surface pib-surface-table overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] text-xs uppercase tracking-widest">
                <th className="text-left p-3">Distinct ID</th>
                <th className="text-left p-3">User ID</th>
                <th className="text-right p-3">Events</th>
                <th className="text-left p-3">First Seen</th>
                <th className="text-left p-3">Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.distinctId} className="border-b border-[var(--color-pib-line)] hover:bg-[var(--color-row-hover)] transition-colors">
                  <td className="p-3 font-mono text-xs">
                    <Link href={`/portal/analytics/users/${encodeURIComponent(u.distinctId)}?propertyId=${encodeURIComponent(propertyId)}`}
                      className="text-[var(--color-pib-accent-hover)] hover:underline">
                      {u.distinctId.slice(0, 16)}…
                    </Link>
                  </td>
                  <td className="p-3 text-[var(--color-pib-text-muted)]">{u.userId ?? ' - '}</td>
                  <td className="p-3 text-right font-mono">{u.eventCount.toLocaleString()}</td>
                  <td className="p-3 text-[var(--color-pib-text-muted)] text-xs">{new Date(u.firstSeen).toLocaleString()}</td>
                  <td className="p-3 text-[var(--color-pib-text-muted)] text-xs">{new Date(u.lastSeen).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && users.length === 0 && propertyId && (
        <EmptyState title="No users found for this property." />
      )}
    </div>
  )
}
