'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { AnalyticsNav } from '@/components/admin/AnalyticsNav'
import { AnalyticsPropertyPicker } from '@/components/admin/AnalyticsPropertyPicker'

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
    <div className="p-6 space-y-6">
      <AnalyticsNav active="users" propertyId={propertyId} />
      <h1 className="text-2xl font-headline font-bold text-on-surface">Users</h1>

      <div className="pib-card p-4 space-y-3">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} />
        <div className="flex justify-end">
          <button className="pib-btn-primary" onClick={load} disabled={!propertyId || loading}>
            {loading ? 'Loading…' : 'Load'}
          </button>
        </div>
      </div>

      {loading && (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <div key={i} className="pib-skeleton h-10 rounded" />)}
        </div>
      )}

      {!loading && users.length > 0 && (
        <div className="pib-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-card-border)] text-on-surface-variant text-xs uppercase tracking-widest">
                <th className="text-left p-3">Distinct ID</th>
                <th className="text-left p-3">User ID</th>
                <th className="text-right p-3">Events</th>
                <th className="text-left p-3">First Seen</th>
                <th className="text-left p-3">Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.distinctId} className="border-b border-[var(--color-card-border)] hover:bg-surface-variant/30 transition-colors">
                  <td className="p-3 font-mono text-xs">
                    <Link href={`/admin/analytics/users/${encodeURIComponent(u.distinctId)}?propertyId=${encodeURIComponent(propertyId)}`}
                      className="text-amber-400 hover:underline">
                      {u.distinctId.slice(0, 16)}…
                    </Link>
                  </td>
                  <td className="p-3 text-on-surface-variant">{u.userId ?? '—'}</td>
                  <td className="p-3 text-right font-mono">{u.eventCount.toLocaleString()}</td>
                  <td className="p-3 text-on-surface-variant text-xs">{new Date(u.firstSeen).toLocaleString()}</td>
                  <td className="p-3 text-on-surface-variant text-xs">{new Date(u.lastSeen).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && users.length === 0 && propertyId && (
        <p className="text-on-surface-variant text-sm">No users found for this property.</p>
      )}
    </div>
  )
}
