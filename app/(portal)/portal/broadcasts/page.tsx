'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/AppFoundation'
import type { Broadcast, BroadcastStatus } from '@/lib/broadcasts/types'

const STATUS_COLORS: Record<BroadcastStatus, string> = {
  draft: 'pib-pill',
  scheduled: 'pib-pill pib-pill-blue',
  sending: 'pib-pill pib-pill-warn',
  sent: 'pib-pill pib-pill-success',
  paused: 'pib-pill pib-pill-warn',
  failed: 'pib-pill pib-pill-danger',
  canceled: 'pib-pill line-through',
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
    <div className="space-y-6" data-module-accent="blue">
      <PageHeader
        accent="blue"
        eyebrow="Email · Broadcasts"
        title="Broadcasts"
        description="One-time email blasts to your audience."
        actions={
          <button onClick={() => setCreating(true)} className="btn-pib-primary btn-pib-sm">
            New Broadcast
          </button>
        }
      />

      {creating && (
        <div className="flex flex-wrap gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Broadcast name (e.g. 'October newsletter')"
            className="pib-input h-8 flex-1 py-1 text-sm"
            onKeyDown={(e) => e.key === 'Enter' && createBroadcast()}
            autoFocus
          />
          <button onClick={createBroadcast} className="btn-pib-primary btn-pib-sm">
            Create
          </button>
          <button
            onClick={() => {
              setCreating(false)
              setNewName('')
            }}
            className="btn-pib-ghost btn-pib-sm"
          >
            Cancel
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="pib-skeleton h-16" />
          ))}
        </div>
      ) : broadcasts.length === 0 ? (
        <div className="pib-empty-state">
          <span aria-hidden="true" className="material-symbols-outlined pib-empty-state-icon">campaign</span>
          <h2 className="pib-empty-state-title">No broadcasts yet</h2>
          <p className="pib-empty-state-description">Create one to send a one-time email blast.</p>
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
                className="pib-card flex items-center justify-between gap-4 transition-colors hover:bg-[var(--color-row-hover)]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="pib-icon-tint pib-icon-tint-blue" aria-hidden="true">
                    <span className="material-symbols-outlined text-[18px]">campaign</span>
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{b.name}</p>
                    {b.description && (
                      <p className="mt-0.5 truncate text-sm text-[var(--color-pib-text-muted)]">{b.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="text-xs tabular-nums text-[var(--color-pib-text-muted)]">
                    {sent}/{audienceSize} sent
                  </span>
                  <span className={STATUS_COLORS[b.status] ?? 'pib-pill'}>
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
