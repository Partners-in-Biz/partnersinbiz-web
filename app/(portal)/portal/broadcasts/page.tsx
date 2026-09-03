'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { PageHeader, EmptyState, Surface } from '@/components/ui/AppFoundation'
import { Button, Field, Input, Status, Skeleton, Icon } from '@/components/studio'
import type { Broadcast, BroadcastStatus } from '@/lib/broadcasts/types'

const STATUS_TONE: Record<BroadcastStatus, 'success' | 'warning' | 'danger' | 'info' | undefined> = {
  draft: undefined,
  scheduled: 'info',
  sending: 'warning',
  sent: 'success',
  paused: 'warning',
  failed: 'danger',
  canceled: undefined,
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
    <div className="space-y-8">
      <PageHeader
        eyebrow="Email"
        title="Broadcasts."
        description="One-time email blasts to your audience."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            New broadcast
          </Button>
        }
      />

      {creating && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field id="broadcast-name" label="Broadcast name">
              <input
                id="broadcast-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="October newsletter"
                aria-label="Broadcast name"
                onKeyDown={(e) => e.key === 'Enter' && createBroadcast()}
                autoFocus
              />
            </Field>
          </div>
          <Button size="sm" onClick={createBroadcast}>
            Create
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setCreating(false)
              setNewName('')
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} height={64} />
          ))}
        </div>
      ) : broadcasts.length === 0 ? (
        <EmptyState
          title="No broadcasts yet."
          description="Create one to send a one-time email blast."
        />
      ) : (
        <div className="space-y-2">
          {broadcasts.map((b) => {
            const audienceSize = b.stats?.audienceSize ?? 0
            const sent = b.stats?.sent ?? 0
            return (
              <Link key={b.id} href={`/portal/broadcasts/${b.id}`} className="block">
                <Surface
                  variant="quiet"
                  className="flex items-center justify-between gap-4 transition-colors hover:border-[var(--sc-ink)]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Icon name="campaign" />
                    <div className="min-w-0">
                      <p className="truncate">{b.name}</p>
                      {b.description && (
                        <p className="sc-body mt-0.5 truncate text-sm text-[var(--sc-ink-soft)]">{b.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    <span className="st-num text-xs text-[var(--sc-ink-soft)]">
                      {sent}/{audienceSize} sent
                    </span>
                    <Status tone={STATUS_TONE[b.status]}>{b.status}</Status>
                  </div>
                </Surface>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
