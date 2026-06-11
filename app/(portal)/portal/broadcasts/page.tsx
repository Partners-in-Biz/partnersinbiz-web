'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Broadcast, BroadcastStatus } from '@/lib/broadcasts/types'

const STATUS_COLORS: Record<BroadcastStatus, string> = {
  draft: 'bg-surface-container text-on-surface-variant',
  scheduled: 'bg-blue-100 text-blue-800',
  sending: 'bg-amber-100 text-amber-800',
  sent: 'bg-green-100 text-green-800',
  paused: 'bg-yellow-100 text-yellow-800',
  failed: 'bg-red-100 text-red-800',
  canceled: 'bg-surface-container text-on-surface-variant line-through',
}

export default function BroadcastsPage() {
  const router = useRouter()
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  useEffect(() => {
    fetch('/api/v1/broadcasts')
      .then((r) => r.json())
      .then((b) => setBroadcasts(b.data ?? []))
      .finally(() => setLoading(false))
  }, [])

  async function createBroadcast() {
    if (!newName.trim()) return
    const res = await fetch('/api/v1/broadcasts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    })
    const body = await res.json()
    if (res.ok && body.data?.id) {
      router.push(`/portal/broadcasts/${body.data.id}`)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-on-surface">Broadcasts</h1>
        <button
          onClick={() => setCreating(true)}
          className="px-4 py-2 rounded-lg bg-primary text-on-primary text-sm font-medium"
        >
          New Broadcast
        </button>
      </div>

      {creating && (
        <div className="mb-4 flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Broadcast name (e.g. 'October newsletter')"
            className="flex-1 px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm"
            onKeyDown={(e) => e.key === 'Enter' && createBroadcast()}
            autoFocus
          />
          <button onClick={createBroadcast} className="px-4 py-2 rounded-lg bg-primary text-on-primary text-sm">
            Create
          </button>
          <button
            onClick={() => {
              setCreating(false)
              setNewName('')
            }}
            className="px-4 py-2 rounded-lg bg-surface-container text-on-surface text-sm"
          >
            Cancel
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-surface-container animate-pulse" />
          ))}
        </div>
      ) : broadcasts.length === 0 ? (
        <div className="text-center py-16 text-on-surface-variant">
          No broadcasts yet. Create one to send a one-time email blast.
        </div>
      ) : (
        <div className="space-y-2">
          {broadcasts.map((b) => {
            const audienceSize = b.stats?.audienceSize ?? 0
            const sent = b.stats?.sent ?? 0
            return (
              <Link
                key={b.id}
                href={`/portal/broadcasts/${b.id}`}
                className="flex items-center justify-between p-4 rounded-xl bg-surface-container hover:bg-surface-container-high transition-colors"
              >
                <div className="min-w-0">
                  <p className="font-medium text-on-surface truncate">{b.name}</p>
                  {b.description && (
                    <p className="text-sm text-on-surface-variant mt-0.5 truncate">{b.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="text-xs text-on-surface-variant tabular-nums">
                    {sent}/{audienceSize} sent
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[b.status] ?? ''}`}
                  >
                    {b.status}
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
