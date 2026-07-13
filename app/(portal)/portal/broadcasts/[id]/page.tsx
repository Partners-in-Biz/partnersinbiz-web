'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import BroadcastEditor from '@/components/admin/broadcasts/BroadcastEditor'
import type { Broadcast } from '@/lib/broadcasts/types'

export default function BroadcastDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const [id, setId] = useState<string | null>(null)
  const [broadcast, setBroadcast] = useState<Broadcast | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    params.then((p) => {
      setId(p.id)
      fetch(`/api/v1/broadcasts/${p.id}`)
        .then((r) => r.json())
        .then((b) => setBroadcast(b.data ?? null))
        .finally(() => setLoading(false))
    })
  }, [params])

  if (loading) return <div className="pib-skeleton h-40" />
  if (!broadcast || !id)
    return (
      <div className="pib-empty-state">
        <span aria-hidden="true" className="material-symbols-outlined pib-empty-state-icon">campaign</span>
        <h2 className="pib-empty-state-title">Broadcast not found.</h2>
      </div>
    )

  return (
    <BroadcastEditor
      id={id}
      initial={broadcast}
      onBack={() => router.push('/portal/broadcasts')}
      onDeleted={() => router.push('/portal/broadcasts')}
    />
  )
}
